import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {applySoundDirections,directClipSound} from '../lib/sound-direction.mjs';
import {resolveSound,planBatchSound} from '../lib/mood.mjs';
import {mediaSettings,musicEnvelope} from '../lib/audio.mjs';
const clip={id:'clip-1',start:10,end:30,mood:'hype',moodConfidence:.9,soundDesign:{effect:'pop',music:false}};
const direction={id:'clip-1',mood:'surprised',confidence:.9,audibleEvidence:'A quiet setup flips into a loud surprised laugh.',hasMusic:false,strongOpening:true,background:'bounce',energy:'punctuate',payoffAt:12,reason:'Lift at the reveal, then leave the laugh clear.',events:[{effect:'impact',at:.1},{effect:'pop',at:12},{effect:'tick',at:12.2},{effect:'chime',at:18}]};
test('heard sound direction overrides transcript-only music guesses and preserves strong openings',()=>{
 const [reviewed]=applySoundDirections([clip],{clips:[direction]});
 assert.equal(reviewed.audioDirection.verified,true);assert.deepEqual(reviewed.audioDirection.events.map(value=>value.at),[12,18]);
 const plan=resolveSound(mediaSettings(),reviewed);assert.equal(plan.background,'bounce');assert.equal(plan.musicEnergy,'punctuate');assert.equal(plan.effectAt,12);assert.equal(plan.effectEvents.length,2);
 assert.equal(planBatchSound([reviewed],mediaSettings(),'fixture')[0].soundPlan.background,'bounce');
 const manual=resolveSound(mediaSettings({effects:'tick',background:'acoustic'}),reviewed);assert.equal(manual.effects,'tick');assert.equal(manual.background,'acoustic');assert.equal(manual.effectEvents,undefined);
});
test('original music is never doubled and sadness cannot get comic accents',()=>{
 const [music]=applySoundDirections([clip],{clips:[{...direction,hasMusic:true}]});assert.equal(resolveSound(mediaSettings(),music).background,'none');
 const [sad]=applySoundDirections([clip],{clips:[{...direction,mood:'sad',background:'melancholy'}]});const plan=resolveSound(mediaSettings(),sad);assert.equal(plan.effects,'none');assert.deepEqual(plan.effectEvents,[]);
});
test('review validation rejects missing clips and unsafe IDs; stale timings and uncertain audio do not force a plan',()=>{
 assert.throws(()=>applySoundDirections([clip],{clips:[{...direction,id:'wrong'}]}),/exactly once/);
 assert.throws(()=>applySoundDirections([clip],{clips:[{...direction,audibleEvidence:''}]}),/incomplete/);
 const [low]=applySoundDirections([clip],{clips:[{...direction,confidence:.2}]});assert.equal(resolveSound(mediaSettings(),low).effects,'none');
 const [valid]=applySoundDirections([clip],{clips:[direction]});assert.equal(resolveSound(mediaSettings(),{...valid,end:31}).effectEvents,undefined);
});
test('verified audio review is cached for the same source and cut, but a changed cut requires new listening',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clipmax-sound-review-')),source=join(dir,'source.mp4');await writeFile(source,'fixture');let calls=0,extractions=0;
 const options={job:{model:'test'},clips:[clip],cues:[],dir,source,ffmpeg:'fixture',execute:async()=>{extractions++;},ask:async input=>{calls++;assert.deepEqual(input.mediaFiles,['clip-1-sound-review.mp3']);assert.match(input.prompt,/actually listen/);return{clips:[direction]};}};
 try{await directClipSound(options);await directClipSound(options);assert.equal(calls,1);assert.equal(extractions,1);
 await directClipSound({...options,clips:[{...clip,end:31}]});assert.equal(calls,2);
 await assert.rejects(directClipSound({...options,clips:[{...clip,id:'../outside'}]}),/valid bounded/);
 }finally{assert.ok(dir.startsWith(join(tmpdir(),'clipmax-sound-review-')));await rm(dir,{recursive:true,force:true});}
});
test('music energy curves change at the payoff while manual steady levels remain constant',()=>{
 assert.match(musicEnvelope(.1,'build',8,20),/0.4\+0.6\*t\/8/);
 assert.match(musicEnvelope(.1,'punctuate',8,20),/8.6/);
 assert.match(musicEnvelope(.1,'release',8,20),/0.4/);
 assert.equal(musicEnvelope(.1,'steady',8,20),'0.1');
});
