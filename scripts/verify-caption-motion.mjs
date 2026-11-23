import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import jpeg from 'jpeg-js';
import ffmpegStatic from 'ffmpeg-static';
import { run, renderArgs } from '../lib/core.mjs';
import { clipAss } from '../lib/captions.mjs';
import { mediaSettings, prepareAudio } from '../lib/audio.mjs';

const ffmpeg=process.env.FFMPEG_PATH||ffmpegStatic,dir=resolve('data/caption-motion-verification');await mkdir(dir,{recursive:true});
const source=join(dir,'source.mp4');
await run(ffmpeg,['-y','-f','lavfi','-i','color=c=0x263420:s=640x360:r=30:d=3','-f','lavfi','-i','sine=frequency=330:duration=3','-c:v','libx264','-c:a','aac','-shortest',source]);
const clip={id:'clip-1',start:0,end:3};
const audio=await prepareAudio({ffmpeg,source,dir,clip,hasAudio:true,settings:mediaSettings({background:'acoustic',effects:'bass_drop',soundSeed:2026})});
for(const style of ['kinetic','highlight','clean']){
 await writeFile(join(dir,'clip-1.ass'),clipAss([{start:0,end:3,text:'Watch this moment come alive.'}],0,3,{style}));
 await run(ffmpeg,renderArgs(source,clip,{framing:{mode:'preserve'},audioFile:audio.file,subtitleFilter:true,animatedCaptions:true}),{cwd:dir});
 await run(ffmpeg,['-v','error','-i',join(dir,'clip-1.mp4'),'-f','null','-']);
 await run(ffmpeg,['-y','-ss','0.2','-i',join(dir,'clip-1.mp4'),'-frames:v','1','-vf','scale=270:480',join(dir,style+'.jpg')]);
 const pixels=jpeg.decode(await readFile(join(dir,style+'.jpg')),{useTArray:true});let white=0,yellow=0;
 for(let y=330;y<410;y++)for(let x=10;x<260;x++){const i=(y*270+x)*4,r=pixels.data[i],g=pixels.data[i+1],b=pixels.data[i+2];if(r>175&&g>175&&b>175)white++;if(r>180&&g>150&&b<150)yellow++;}
 assert.ok(white>20,`${style}: captions must actually appear in the safe region`);if(style!=='clean')assert.ok(yellow>10,`${style}: active word must be highlighted`);
 if(style==='kinetic'){
  for(const [label,at] of [['early','0.033'],['settled','0.2']])await run(ffmpeg,['-y','-ss',at,'-i',join(dir,'clip-1.mp4'),'-vf','crop=1080:300:0:1250,scale=540:150','-frames:v','1',join(dir,label+'.jpg')]);
  const a=jpeg.decode(await readFile(join(dir,'early.jpg'))).data,b=jpeg.decode(await readFile(join(dir,'settled.jpg'))).data;
  let changed=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>100)changed++;
  assert.ok(changed>80,'Entrance must visibly change the rendered text position/scale');
 }
}
console.log('PASS: All three caption styles render visibly; highlighted words and kinetic entrance change real pixels; mixed audio/video decode.');
