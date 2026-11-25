import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const context={window:{},URL,Date}; vm.createContext(context);
vm.runInContext(await readFile(new URL('../public/workflow.js',import.meta.url),'utf8'),context);
const activity=context.window.ClipmaxWorkflow.activity;

test('AI work stays indeterminate; idle projects do not claim active progress',()=>{
 const job={status:'ready',editing:true,workflow:{stages:{metadata:{state:'running',percent:null,message:'Writing details'}}}};
 const result=activity(job);
 assert.match(result,/AI title, description &amp; tags/);assert.match(result,/Working…/);
 assert.match(result,/<progress[^>]*max="100"  aria-label=/);assert.ok(!result.includes('value="'));
 assert.equal(activity({...job,editing:false}),'');
});
test('upload bar uses real clip/platform measurements and escapes platform messages',()=>{
 const job={status:'ready',publishing:true,workflow:{clips:{'clip-2':{'upload:youtube':{state:'running',percent:37,bytes:370000,totalBytes:1000000,message:'Sending <video> bytes'}}}}};
 const result=activity(job);
 assert.match(result,/Uploading clip 2 to YouTube/);assert.match(result,/value="37"/);assert.match(result,/37%/);assert.match(result,/361 KB \/ 977 KB/);
 assert.ok(result.includes('Sending &lt;video&gt; bytes'));assert.ok(!result.includes('<video>'));
 delete job.workflow.clips['clip-2']['upload:youtube'].percent;
 assert.match(activity(job),/Working…/);
});
test('native sound review shows listening activity without invented percentages',()=>{
 const result=activity({status:'analyzing',workflow:{stages:{soundDirection:{state:'running',percent:null,message:'Listening to selected clip audio'}}}});
 assert.match(result,/Listening to clip audio &amp; planning sound/);assert.ok(!result.includes('value="'));assert.match(result,/Listening to selected clip audio/);
});
