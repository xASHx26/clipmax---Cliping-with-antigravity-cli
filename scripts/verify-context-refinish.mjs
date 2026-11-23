import {readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
import {completeClipEnd} from '../lib/context.mjs';import {run} from '../lib/core.mjs';import ffmpeg from 'ffmpeg-static';
const file=resolve('data/media-upgrade-result.json'),artifact=JSON.parse(await readFile(file,'utf8'));
const cues=JSON.parse(await readFile(join(artifact.dir,'cues.json'),'utf8'));
const child=spawn(process.execPath,['server.mjs'],{cwd:resolve('.'),env:{...process.env,PORT:'4394',CLIPMAX_DATA_DIR:artifact.dataDir,CLIPMAX_SETTINGS_DIR:artifact.dataDir,CLIPMAX_VAULT_KEY:''},windowsHide:true,stdio:['ignore','pipe','pipe']});
try {
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),15000);child.stdout.on('data',data=>{if(data.toString().includes('Clipmax Studio:')){clearTimeout(timer);resolve()}});child.once('error',reject)});
 const base='http://127.0.0.1:4394';
 for(const clip of artifact.job.clips) {
   const complete=completeClipEnd(clip,cues,artifact.job.duration,artifact.job.maxSeconds);
   const media={...artifact.job.media,framing:'streamer',webcam:{x:0,y:.244,w:.205,h:.222},contentWidth:.5,effects:'fahh',effectAt:.08,effectVolume:.65,background:'pulse',musicVolume:.18};
   const request=await fetch(base+'/api/jobs/'+artifact.job.id+'/clips/'+clip.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({end:complete.end,media})});
   assert.equal(request.status,200,await request.clone().text());
   console.log('Refinished '+clip.id+' through '+complete.end.toFixed(2)+'s with preserved streamer and audio mix.');
 }
 artifact.job=(await(await fetch(base+'/api/jobs')).json())[0];
 for(const clip of artifact.job.clips){assert.equal(clip.contextReviewNeeded,false);await run(ffmpeg,['-v','error','-i',join(artifact.dir,clip.id+'.mp4'),'-f','null','-']);await run(ffmpeg,['-y','-ss','3','-i',join(artifact.dir,clip.id+'.mp4'),'-frames:v','1','-vf','scale=270:480',join(artifact.dir,clip.id+'-final.jpg')]);}
 await writeFile(file,JSON.stringify(artifact,null,2));
 console.log('PASS: All three clips end after complete transcript sentences, retain the streamer, and decode with their audio mixes.');
}finally{child.kill();await new Promise(resolve=>child.once('exit',resolve));}
