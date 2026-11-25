// Isolated pipeline: synthetic video, fake CLI, no network or platform uploads.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import ffmpeg from 'ffmpeg-static';
import {run} from '../lib/core.mjs';
if(process.platform!=='win32')throw Error('This fixture uses the Windows test compiler.');
const home=await mkdtemp(join(tmpdir(),'clipmax-native-sound-')),data=join(home,'projects'),source=join(home,'source.mp4'),exe=join(home,'ai.exe');await mkdir(data);
const plan={clips:[{start:0,end:6,title:'A complete test',description:'A complete test story',tags:['test'],caption:'A complete test',reason:'Setup and final answer.',score:80,mood:'playful',momentType:'funny',moodConfidence:.9,moodReason:'An amusing complete answer.',evidence:'That is finished.',endingQuote:'That is finished.',arcComplete:true,momentScore:80,soundDesign:{effect:'none',at:0,music:true,reason:'Keep the setup clear.'}}]};
const sound={clips:[{id:'clip-1',mood:'playful',confidence:.9,audibleEvidence:'A clear vocal setup leads to a bright laugh.',hasMusic:false,strongOpening:true,background:'bounce',energy:'build',payoffAt:4.4,reason:'Lift toward the payoff.',events:[{effect:'pop',at:2.4,reason:'Reveal'},{effect:'chime',at:4.4,reason:'Resolution'}]}]};
const event={event:'step_update',step_update:{state:'DONE',step_type:'tool',tool_name:'read_file',tool_info:{parameters:{Path:'clip-1-sound-review.mp3'}}}};
const result=value=>JSON.stringify(JSON.stringify({event:'result',result:{status:'SUCCESS',structured_output:value}}));
await writeFile(join(home,'ai.cs'),`using System;class Fixture{static void Main(string[] args){string input=Console.In.ReadToEnd();int i=Array.IndexOf(args,"--model");string mode=i>=0?args[i+1]:"";if(input.Contains("You are an audio director")){if(mode=="quota"){Console.WriteLine(${JSON.stringify(JSON.stringify({event:'result',result:{status:'ERROR',error:{code:'RESOURCE_EXHAUSTED',message:'Quota exhausted'}}}))});return;}if(mode!="unread")Console.WriteLine(${JSON.stringify(JSON.stringify(event))});Console.WriteLine(${result(sound)});}else Console.WriteLine(${result(plan)});}}`);
await run('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:exe','/out:'+exe,join(home,'ai.cs')]);
await run(ffmpeg,['-y','-f','lavfi','-i','testsrc2=size=640x360:rate=24:duration=8','-f','lavfi','-i','sine=frequency=300:sample_rate=48000:duration=8','-c:v','libx264','-preset','ultrafast','-c:a','aac','-shortest',source]);
const ids={};for(const model of ['success','unread','quota']){const id=ids[model]=randomUUID(),dir=join(data,id);await mkdir(dir);await copyFile(source,join(dir,'source.mp4'));await writeFile(join(dir,'cues.json'),JSON.stringify([{start:0,end:5.5,text:'A complete test story. That is finished.'}]));await writeFile(join(dir,'job.json'),JSON.stringify({id,title:'Sound fixture',url:'https://youtu.be/sound-fixture',status:'ready',provider:'antigravity',model,duration:8,count:1,maxSeconds:10,aspect:'9:16',captions:true,createdAt:new Date().toISOString(),clips:[],media:{framing:'preserve',background:'auto',effects:'auto'},autoUpload:{enabled:false}}));}
const child=spawn(process.execPath,['server.mjs'],{cwd:resolve('.'),env:{...process.env,PORT:'4398',CLIPMAX_DATA_DIR:data,CLIPMAX_SETTINGS_DIR:home,CLIPMAX_VAULT_KEY:'',AGY_PATH:exe,FFMPEG_PATH:ffmpeg},windowsHide:true,stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',part=>errors+=part);
const base='http://127.0.0.1:4398',call=async(path,body)=>{const response=await fetch(base+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
async function completed(id){for(let i=0;i<600;i++){const job=(await call('/api/jobs')).find(job=>job.id===id);if(['ready','paused','failed'].includes(job.status)&&!job.canCancel)return job;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Sound pipeline timeout: '+errors);}
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);child.stdout.on('data',part=>{if(part.toString().includes('Clipmax Studio:')){clearTimeout(timer);resolve();}});child.once('error',reject);});
 for(const model of ['success','unread','quota']){
  await call('/api/jobs/'+ids[model]+'/refine',{media:{framing:'preserve',background:'auto',effects:'auto'}});const job=await completed(ids[model]);
  if(model==='quota'){assert.equal(job.status,'paused');assert.equal(job.workflow.stages.soundDirection.state,'waiting');assert.equal(await readFile(join(data,job.id,'cues.json'),'utf8'),'[{"start":0,"end":5.5,"text":"A complete test story. That is finished."}]');continue;}
  assert.equal(job.status,'ready',job.error);assert.ok(job.clips[0].url);
  if(model==='success'){assert.equal(job.clips[0].audioDirection.verified,true);assert.equal(job.clips[0].audio.effectEvents.length,2);assert.equal(job.clips[0].audio.musicEnergy,'build');assert.equal(job.workflow.stages.soundDirection.state,'done');}
  else{assert.equal(job.clips[0].audioDirection,undefined);assert.match(job.soundNotice,/transcript context/);assert.equal(job.workflow.stages.soundDirection.state,'skipped');}
 }
 console.log('PASS: Verified native read drives the exported mix; unverified reads show transcript fallback; sound-review quota pauses with source/captions saved.');
}finally{child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));assert.ok(home.startsWith(join(tmpdir(),'clipmax-native-sound-')));await rm(home,{recursive:true,force:true});}
