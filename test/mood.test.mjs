import test from 'node:test';import assert from 'node:assert/strict';
import {editorialTags,groundMood,resolveSound,planBatchSound} from '../lib/mood.mjs';import {mediaSettings} from '../lib/audio.mjs';
const settings=mediaSettings();
const clip=(mood,extra={})=>({id:'clip-1',start:0,end:10,mood,moodConfidence:.9,soundDesign:{effect:'none',music:true,at:.12},...extra});
test('auto mode never puts a comedic hit on a sad clip, but explicit choices remain editable',()=>{
 const sad=clip('sad',{soundDesign:{effect:'notification',music:true,at:.1},messageContext:true});
 const plan=resolveSound(settings,sad);assert.equal(plan.effects,'none');assert.equal(plan.background,'melancholy');
 assert.equal(resolveSound({...settings,effects:'pop'},sad).effects,'pop');
 assert.equal(mediaSettings().effects,'auto');assert.equal(mediaSettings().background,'auto');
});
test('pings require message context, repeated effects are varied, and uncertain moods get no hit',()=>{
 const first=clip('awkward',{soundDesign:{effect:'record_stop',music:true,at:.2}});
 const plans=planBatchSound([first,{...first,id:'clip-2'}],settings);assert.notEqual(plans[0].soundPlan.effects,plans[1].soundPlan.effects);
 assert.notEqual(resolveSound(settings,clip('playful',{soundDesign:{effect:'notification',music:true}})).effects,'notification');
 assert.equal(resolveSound(settings,clip('playful',{messageContext:true,soundDesign:{effect:'notification',music:true}})).effects,'notification');
 assert.equal(resolveSound(settings,clip('sad',{moodConfidence:.3})).background,'ambient');
 assert.equal(resolveSound(settings,clip('surprised',{moodConfidence:.3})).effects,'none');
});
test('mood evidence is checked against the selected transcript, and existing music is kept',()=>{
 const data={...editorialTags({mood:'awkward',momentType:'out_of_pocket',moodConfidence:.9,evidence:'Why did you say that?',soundDesign:{effect:'tick'}}),start:5,end:10};
 const verified=groundMood(data,[{start:5,end:8,text:'Why did you say that?'},{start:8,end:10,text:'(upbeat music)'}]);
 assert.equal(verified.moodEvidenceVerified,true);assert.equal(resolveSound(settings,verified).background,'none');
 assert.equal(groundMood({...data,evidence:'invented'},[{start:5,end:8,text:'Other words'}]).moodConfidence,.5);
});
test('automatic batches vary background families and save a distinct repeatable arrangement per clip',()=>{
 const clips=Array.from({length:3},(_,i)=>clip('playful',{id:'clip-'+(i+1),start:i*10,end:i*10+10}));
 const plans=planBatchSound(clips,settings,'project-one');
 assert.equal(new Set(plans.map(c=>c.soundPlan.background)).size,3);
 assert.equal(new Set(plans.map(c=>c.soundPlan.soundSeed)).size,3);
 assert.deepEqual(plans,planBatchSound(clips,settings,'project-one'));
 assert.notEqual(plans[0].soundPlan.soundSeed,planBatchSound(clips,settings,'project-two')[0].soundPlan.soundSeed);
 assert.equal(resolveSound(settings,clip('hype',{soundDesign:{effect:'none',music:false}})).background,'none');
});
test('an accent can land on the payoff and is bounded inside the clip',()=>{
 const data=clip('hype',{end:30,soundDesign:{effect:'bass_drop',at:18,music:true}});
 assert.equal(resolveSound(settings,data).effectAt,18);
 assert.equal(resolveSound(settings,{...data,end:10}).effectAt,9.6);
});
