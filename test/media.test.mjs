import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaSettings, hookWave } from '../lib/audio.mjs';
import { safeWebcam, cameraPanels, headSafeBox } from '../lib/framing.mjs';
import { renderArgs } from '../lib/core.mjs';
import { completeClipEnd } from '../lib/context.mjs';

test('audio levels and webcam coordinates are bounded and unsafe boxes fall back',()=>{
  assert.equal(mediaSettings({musicVolume:100,sourceVolume:-10}).musicVolume,.5);
  assert.equal(mediaSettings({sourceVolume:-10}).sourceVolume,0);
  assert.equal(safeWebcam({x:.9,y:0,w:.2,h:.2}),null);
  assert.deepEqual(safeWebcam({x:0,y:.25,w:.2,h:.22}),{x:0,y:.25,w:.2,h:.22});
});
test('the built-in hook is an original non-silent PCM sound with adjustable mix level',()=>{
  const sound=hookWave();assert.equal(sound.toString('ascii',0,4),'RIFF');assert.equal(sound.readUInt32LE(24),48000);
  assert.ok(sound.subarray(44).some(byte=>byte!==0));assert.equal(mediaSettings({effectVolume:10}).effectVolume,1);
  assert.equal(mediaSettings().effects,'auto');
});
test('streamer layout composes webcam with source and maps prepared audio explicitly',()=>{
  const args=renderArgs('source.mp4',{id:'clip-1',start:10,end:20},{framing:{mode:'streamer',webcam:{x:0,y:.25,w:.2,h:.22}},audioFile:'mix.wav',subtitleFilter:true});
  assert.ok(args.includes('1:a:0')); const filter=args[args.indexOf('-filter_complex')+1];
  assert.match(filter,/vstack=inputs=2/);assert.match(filter,/subtitles=clip-1.srt/);
  assert.match(filter,/crop[^;]+force_original_aspect_ratio=decrease,pad=1080:640/);
  assert.match(renderArgs('source.mp4',{id:'clip-1',start:0,end:5},{framing:{mode:'preserve'}}).join(' '),/overlay=\(W-w\)\/2/);
});
test('webcam panel detection adds headroom and face boxes include the full head',()=>{
  const width=960,height=540,data=new Uint8Array(width*height*4);
  for(let y=203;y<323;y++)for(let x=0;x<213;x++){const i=(y*width+x)*4;data[i]=45;data[i+1]=100;data[i+2]=210;data[i+3]=255;}
  const panel=cameraPanels({width,height,data})[0];assert.ok(panel);assert.ok(panel.y<=203/height);assert.ok(panel.y+panel.h>=323/height);
  const face={x:.06,y:.42,w:.08,h:.10},box=headSafeBox([face]);assert.ok(box.y<face.y-.06);assert.ok(box.y+box.h>face.y+face.h);
});
test('clip endings complete nearby sentences and leave a short pause within the length limit',()=>{
  const clip={start:10,end:20};const cues=[{start:19,end:21,text:'This finishes the thought.'},{start:22,end:25,text:'Another story.'}];
  assert.equal(completeClipEnd(clip,cues,40,15).end,21.35);
  assert.equal(completeClipEnd(clip,cues,40,10).contextReviewNeeded,true);
  assert.equal(completeClipEnd(clip,[{start:19,end:21,text:'This is unfinished because'}],40,15).contextReviewNeeded,true);
  assert.equal(completeClipEnd({start:0,end:20},[{start:17,end:18,text:'The point is finished.'},{start:18,end:20,text:'(music)'}],40,30).end,18.35);
  assert.equal(completeClipEnd({start:0,end:20},[{start:19,end:20,text:'Finished. But another thought'},{start:20,end:27,text:'continues until here.'}],40,30).end,27.35);
  assert.equal(completeClipEnd({start:0,end:10,endingQuote:'That is unbelievable',arcComplete:true},[{start:8,end:10,text:'That is unbelievable'}],40,30).contextReviewNeeded,false);
  assert.equal(completeClipEnd({start:0,end:10,endingQuote:'It happened because',arcComplete:true},[{start:8,end:10,text:'It happened because'}],40,30).contextReviewNeeded,true);
});
