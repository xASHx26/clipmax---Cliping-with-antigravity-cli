import {access,copyFile,lstat,mkdtemp,readFile,readdir,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {directClipSound} from './sound-direction.mjs';
import {mediaSettings,prepareAudio,probeSource} from './audio.mjs';
import {groundMood,resolveSound,soundSeed} from './mood.mjs';
import {run} from './core.mjs';
import {mediaProgress} from './progress.mjs';
import {throwIfCancelled} from './cancellation.mjs';

const valid=id=>/^clip-[1-6]$/.test(id);
async function safeWork(dir,work){
 const root=await realpath(dir),actual=await realpath(work),distance=relative(root,actual),info=await lstat(work);
 if(!distance||distance.startsWith('..')||isAbsolute(distance)||info.isSymbolicLink()||!/^\.sound-reedit-[A-Za-z0-9]{6}$/.test(distance))throw Error('Invalid sound-edit working folder.');
 return actual;
}
async function cleanup(dir,work){await rm(await safeWork(dir,work),{recursive:true,force:true,maxRetries:3,retryDelay:100});}
export async function recoverSoundReedits(dir,job){
 const result={restored:false,committed:false,needsAttention:false};
 for(const name of await readdir(dir)){
  if(!/^\.sound-reedit-[A-Za-z0-9]{6}$/.test(name))continue;
  const work=join(dir,name);
  let committed=false;
  try{await safeWork(dir,work);let manifest;try{manifest=JSON.parse(await readFile(join(work,'commit.json'),'utf8'));}catch(error){if(error.code==='ENOENT'){await cleanup(dir,work);continue;}throw error;}
   if(!Array.isArray(manifest.ids)||!manifest.ids.length||manifest.ids.some(id=>!valid(id))||typeof manifest.revision!=='string')continue;
   committed=manifest.committed===true||manifest.ids.every(id=>job.clips?.find(clip=>clip.id===id)?.soundReedit?.revision===manifest.revision);
   if(!committed){for(const id of manifest.ids)await copyFile(join(work,id+'-previous.mp4'),join(dir,id+'.mp4'));result.restored=true;}
   else{result.committed=true;await writeFile(join(work,'commit.json'),JSON.stringify({...manifest,committed:true}));}
   await cleanup(dir,work);
  }catch{if(!committed)result.needsAttention=true; /* Keep locked or incomplete recovery files. */ }
 }
 return result;
}
export async function remixGeneratedSound({job,clipIds,dir,ffmpeg,report=()=>{},beforeCommit=()=>{},commit=async()=>{},review=directClipSound,mix=prepareAudio,execute=run,probe=probeSource}){
 if(!Array.isArray(clipIds)||!clipIds.length||new Set(clipIds).size!==clipIds.length||clipIds.some(id=>!valid(id)||!job.clips.some(clip=>clip.id===id&&clip.url)))throw Error('Select valid generated clips to re-edit.');
 const source=join(dir,'source.mp4');
 try{await access(source);for(const id of clipIds)await access(join(dir,id+'.mp4'));}catch{throw Error('The saved import or a selected clip is missing. Import the video again before re-editing sound.');}
 if(!(await probe(ffmpeg,source)).hasAudio)throw Error('The imported video has no audio to review. Choose sound manually in Edit clip.');
 const cues=JSON.parse(await readFile(join(dir,'cues.json'),'utf8')),work=await mkdtemp(join(dir,'.sound-reedit-')),revision=randomUUID(),ids=job.clips.filter(clip=>clipIds.includes(clip.id)).map(clip=>clip.id);
 let backed=false,persisted=false,recoveryNeeded=false;
 try{
  report('soundDirection',{state:'running',percent:null,message:'Listening to selected clips and choosing new sound'});
  const reviewed=await review({job:{...job,model:job.provider==='antigravity'?job.model:undefined},clips:job.clips.filter(clip=>ids.includes(clip.id)).map(clip=>groundMood(clip,cues)),cues,dir:work,source,ffmpeg,onProgress:patch=>report('soundDirection',{...patch,state:'running'})});
  report('soundDirection',{state:'done',message:'New mood-aware sound plans ready'});
  const updated=[],used=new Set();
  for(const [index,clip]of reviewed.entries()){
   throwIfCancelled();
   const current=mediaSettings(clip.media||job.media),media={...current,background:'auto',effects:'auto',musicVolume:current.musicVolume||.18,effectVolume:current.effectVolume||.4,soundSeed:soundSeed(revision+':'+clip.id)};
   const plan=resolveSound(media,clip,used);for(const event of plan.effectEvents||[])used.add(event.effect);
   report('editing',{state:'pending',percent:0,message:'Waiting for the new audio mix'});
   report('audio',{state:'running',percent:index/ids.length*100,message:`Re-editing sound ${index+1}/${ids.length}`});
   const audio=await mix({ffmpeg,source,dir:work,clip,settings:plan,hasAudio:true,onProgress:patch=>{report('audio',{...patch,state:'running'},clip.id);report('audio',{state:'running',percent:(index+(patch.percent||0)/100)/ids.length*100,message:`${clip.id}: ${patch.message}`});}});
   report('audio',{state:'done',message:'New audio mixed'},clip.id);report('audio',{state:'pending',percent:(index+1)/ids.length*100,message:'Audio mix ready'});
   report('editing',{state:'running',percent:index/ids.length*100,message:`Replacing audio ${index+1}/${ids.length} · video stays unchanged`});
   await execute(ffmpeg,['-y','-i',join(dir,clip.id+'.mp4'),'-i',audio.file,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','256k','-ar','48000','-t',String(clip.end-clip.start),'-movflags','+faststart','-progress','pipe:1','-nostats',join(work,clip.id+'.mp4')],{onLine:mediaProgress(clip.end-clip.start,patch=>{report('editing',{...patch,state:'running',message:'Keeping video and replacing audio'},clip.id);report('editing',{state:'running',percent:(index+(patch.percent||0)/100)/ids.length*100,message:`Updating clip sound ${index+1}/${ids.length}`});})});
   report('editing',{state:'done',message:'Video preserved · new audio ready'},clip.id);
   updated.push({...clip,media,soundPlan:plan,audio:{...audio,file:undefined,normalized:plan.normalize},soundReedit:{revision,updatedAt:new Date().toISOString(),onlineUnchanged:Object.keys(clip.publications||{}).length>0},url:`/media/${job.id}/${clip.id}.mp4?sound=${revision}`});
  }
  throwIfCancelled();
  for(const id of ids)await copyFile(join(dir,id+'.mp4'),join(work,id+'-previous.mp4'));
  await writeFile(join(work,'commit.json'),JSON.stringify({revision,ids}));backed=true;
  await beforeCommit();
  for(const id of ids)await rename(join(work,id+'.mp4'),join(dir,id+'.mp4'));
  await commit(updated);persisted=true;
  await writeFile(join(work,'commit.json'),JSON.stringify({revision,ids,committed:true}));
  report('audio',{state:'done',message:'Selected clip sound re-edited'});report('editing',{state:'done',message:'New sound saved · video, captions and cuts preserved'});
  return updated;
 }catch(error){
  if(persisted){recoveryNeeded=true;error.recoveryNeeded=true;}
  else if(backed){try{for(const id of ids)await copyFile(join(work,id+'-previous.mp4'),join(dir,id+'.mp4'));}catch{recoveryNeeded=true;error.recoveryNeeded=true;}}
  throw error;
 }finally{if(!recoveryNeeded)await cleanup(dir,work).catch(()=>{});}
}
