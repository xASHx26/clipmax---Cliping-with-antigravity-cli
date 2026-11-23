import assert from 'node:assert/strict';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { prepareAudio, mediaSettings, probeSource, hookWave } from '../lib/audio.mjs';
import { effectWave } from '../lib/sounds.mjs';
import { resolveSound } from '../lib/mood.mjs';
import { run, renderArgs } from '../lib/core.mjs';
const dir=resolve('data/audio-render-verification');await mkdir(dir,{recursive:true});
const source=resolve('data/verification/source.mp4');const clip={id:'clip-1',start:0,end:5};
assert.equal((await probeSource(ffmpeg,source)).hasAudio,true);
const custom=join(dir,'custom.wav');await writeFile(custom,hookWave());
for(const effect of ['notification','pop','tick','chime','sting','record_stop','whoosh','impact','custom']) {
  const settings=mediaSettings({effects:effect,background:effect==='custom'?'custom':effect==='pop'?'ambient':'pulse'});
  const audio=await prepareAudio({ffmpeg,source,dir,clip,settings,hasAudio:true,customEffect:custom,customMusic:custom});
  assert.ok((await stat(audio.file)).size>1000);
  await writeFile(join(dir,'clip-1.srt'),'1\n00:00:00,000 --> 00:00:05,000\nSpeech stays clear\n');
  await run(ffmpeg,renderArgs(source,clip,{framing:{mode:effect==='pop'?'streamer':'preserve',webcam:{x:0,y:.2,w:.2,h:.25}},audioFile:audio.file,subtitleFilter:true}),{cwd:dir});
  let audioStream=false,volume='';
  await run(ffmpeg,['-i',join(dir,'clip-1.mp4'),'-af','volumedetect','-f','null','-'],{onLine:line=>{if(line.includes('Audio: aac'))audioStream=true;if(line.includes('mean_volume'))volume=line;}});
  assert.ok(audioStream);assert.ok(volume&&!volume.includes('-inf'));
}
const sad=resolveSound(mediaSettings(),{mood:'sad',moodConfidence:.9,soundDesign:{effect:'pop',music:true}});
assert.equal(sad.effects,'none');assert.equal(sad.background,'melancholy');
await prepareAudio({ffmpeg,source,dir,clip,settings:sad,hasAudio:true});
await writeFile(join(dir,'opening-notification.wav'),effectWave('notification'));
console.log('PASS: All eight clean opening accents, custom audio, mood-aware backgrounds, sad-without-comic-hit behavior, captions and audible AAC exports.');
