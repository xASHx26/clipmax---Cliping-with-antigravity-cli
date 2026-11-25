// Real FFmpeg checks against generated tones and silence; no provider or uploads.
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import bundledFFmpeg from 'ffmpeg-static';
import {run} from '../lib/core.mjs';
import {prepareAudio,mediaSettings} from '../lib/audio.mjs';
const ffmpeg=process.env.FFMPEG_PATH||bundledFFmpeg;
const dir=await mkdtemp(join(tmpdir(),'clipmax-sound-check-'));
try{
const source=join(dir,'speech.wav'),music=join(dir,'music.wav');
await run(ffmpeg,['-y','-f','lavfi','-i','sine=frequency=300:sample_rate=48000:duration=8','-af',"volume='if(between(t,1,2)+between(t,4,5),2,0)':eval=frame",source]);
await run(ffmpeg,['-y','-f','lavfi','-i','sine=frequency=1200:sample_rate=48000:duration=8',music]);
const clip={id:'clip-1',start:0,end:8,mood:'neutral',moodConfidence:1};
const options=mediaSettings({background:'custom',effects:'none',normalize:false,musicVolume:.35});
async function level(file,start,duration,filter=''){
 let mean,max;
 await run(ffmpeg,['-ss',String(start),'-i',file,'-t',String(duration),'-af',(filter?filter+',':'')+'volumedetect','-f','null','-'],{onLine:line=>{const a=line.match(/mean_volume:\s*(-?[\d.]+)/),b=line.match(/max_volume:\s*(-?[\d.]+)/);if(a)mean=Number(a[1]);if(b)max=Number(b[1]);}});
 assert.ok(Number.isFinite(mean)&&Number.isFinite(max));return {mean,max};
}
const ducked=await prepareAudio({ffmpeg,source,dir,clip,settings:options,hasAudio:true,customMusic:music});
await copyFile(ducked.file,join(dir,'speech-ducked.wav'));
const quiet=await level(ducked.file,2.8,.4,'bandpass=f=1200:width_type=h:width=100'),talking=await level(ducked.file,1.4,.3,'bandpass=f=1200:width_type=h:width=100');
assert.ok(quiet.mean-talking.mean>5,JSON.stringify({quiet,talking}));
for(const energy of ['build','release','punctuate']){
 const mix=await prepareAudio({ffmpeg,source,dir,clip,settings:{...options,musicEnergy:energy,payoffAt:3.8},hasAudio:false,customMusic:music});
 await copyFile(mix.file,join(dir,energy+'.wav'));
 const before=await level(mix.file,2.5,.4),after=await level(mix.file,6,.4);
 if(energy==='build')assert.ok(after.mean>before.mean+1);
 else assert.ok(after.mean<before.mean-4);
}
const accents=await prepareAudio({ffmpeg,source,dir,clip,settings:{...mediaSettings({background:'none',effects:'pop',normalize:false,effectVolume:.4}),effectEvents:[{effect:'pop',at:2.6},{effect:'bass_drop',at:5.6}]},hasAudio:false});
assert.equal(accents.effectEvents.length,2);
const hit=await level(accents.file,5.6,.22,'lowpass=f=140');assert.ok(hit.mean>-55);
assert.ok((await level(accents.file,0,8)).max<=-.4);
console.log('PASS: Measured speech ducking >5 dB, build/release/punchline energy changes, two timed accents, preserved bass body, and peak-limited audio.');
}finally{assert.ok(dir.startsWith(join(tmpdir(),'clipmax-sound-check-')));await rm(dir,{recursive:true,force:true});}
