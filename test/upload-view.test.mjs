import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {publish,rejectedPublication} from '../lib/publish.mjs';
const context={window:{},Date,URL};vm.createContext(context);
vm.runInContext(await readFile(new URL('../public/workflow.js',import.meta.url),'utf8'),context);
const {uploadProgress,uploadFailure}=context.window.ClipmaxWorkflow;
const watch={clipIds:['clip-1','clip-2'],platforms:['youtube']};
test('publishing panel uses real per-upload measurements and leaves preparation indeterminate',()=>{
 const job={publishing:true,clips:[{id:'clip-1',title:'First',publications:{youtube:{status:'uploaded'}}},{id:'clip-2',title:'Second'}],workflow:{clips:{'clip-2':{'upload:youtube':{state:'running',percent:40,bytes:400000,message:'Sending video bytes'}}}}};
 let html=uploadProgress(job,watch);assert.match(html,/value="70"/);assert.match(html,/40% uploaded/);assert.match(html,/1 of 2 uploads accepted/);
 job.workflow.clips['clip-2']['upload:youtube'].percent=null;
 html=uploadProgress(job,watch);assert.match(html,/<progress max="100"  aria-label="Selected uploads progress"/);
 assert.match(uploadProgress(job,{...watch,requestPending:true}),/uploads accepted/);
});
test('failed uploads remain visible with the platform rejection and do not display success',()=>{
 const job={publishing:false,clips:[{id:'clip-1',title:'<clip>',publications:{youtube:{status:'unknown',error:'Platform request failed (400): The user has exceeded the number of videos they may upload.'}}}]};
 const html=uploadProgress(job,{clipIds:['clip-1'],platforms:['youtube']});
 assert.match(html,/Publishing needs attention/);assert.match(html,/daily channel upload limit/);assert.match(html,/24 hours/);assert.match(html,/&lt;clip&gt;/);assert.ok(!html.includes('value="100"'));
 assert.match(uploadFailure(job),/role="alert"/);assert.match(uploadFailure(job),/daily upload limit reached/);
 const requestError=uploadProgress(job,{...watch,error:'Consent required',requestPending:false});assert.match(requestError,/Consent required/);assert.match(requestError,/Review needed/);
});
test('accepted uploads reach 100 percent while platform processing stays distinct',()=>{
 const job={publishing:false,clips:[{id:'clip-1',publications:{youtube:{status:'processing'}}}]};
 const html=uploadProgress(job,{clipIds:['clip-1'],platforms:['youtube']});
 assert.match(html,/value="100"/);assert.match(html,/may still be processing/);assert.ok(!html.includes('Live on the platform'));
});
test('definitive rejections may be retried by a new publish request; ambiguous outcomes remain protected',()=>{
 assert.equal(rejectedPublication({status:'failed'}),true);
 assert.equal(rejectedPublication({status:'unknown',error:'Platform request failed (400): The user has exceeded the number of videos they may upload.'}),true);
 assert.equal(rejectedPublication({status:'unknown',error:'Network timed out'}),false);
 assert.equal(rejectedPublication({status:'uploaded'}),false);
});
test('YouTube initiation rejection is a failed upload before any video bytes are sent',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clipmax-rejected-')),file=join(dir,'clip.mp4'),original=globalThis.fetch;
 await writeFile(file,'fake clip');let calls=0;
 try{globalThis.fetch=async()=>{calls++;return Response.json({error:{message:'The user has exceeded the number of videos they may upload.',errors:[{reason:'uploadLimitExceeded'}]}},{status:400});};
 await assert.rejects(publish('youtube',{}, {title:'Test'},file,{youtubePrivacy:'private'},{YOUTUBE_ACCESS_TOKEN:'fixture'},()=>{}),error=>error.uploadRejected===true&&error.reason==='uploadLimitExceeded');assert.equal(calls,1);
 }finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});
