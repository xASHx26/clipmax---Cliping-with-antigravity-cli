export const MOODS = ['sad','awkward','surprised','playful','hype','tense','warm','neutral'];
export const MOMENTS = ['weird','sad','out_of_pocket','funny','hype','reflective','other'];
export const EFFECTS = ['none','notification','pop','tick','chime','sting','record_stop','whoosh','impact','bass_drop','rimshot','rewind','camera','sparkle','error','slide','energy','glass'];
export function soundSeed(value) { let seed=2166136261;for(const c of String(value)){seed^=c.charCodeAt(0);seed=Math.imul(seed,16777619);}return seed>>>0; }
export const FOCUSES = ['weird_sad_unexpected','weird','sad','out_of_pocket','balanced'];
const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number(n)||0));
export function editorialTags(input={}) {
  const sound=input.soundDesign || {};
  return { mood:MOODS.includes(input.mood)?input.mood:'neutral', momentType:MOMENTS.includes(input.momentType)?input.momentType:'other', moodConfidence:clamp(input.moodConfidence,0,1), moodReason:String(input.moodReason || '').slice(0,450), evidence:String(input.evidence || '').slice(0,240), endingQuote:String(input.endingQuote || '').slice(0,240),arcComplete:input.arcComplete===true,momentScore:clamp(input.momentScore ?? input.score,0,100), soundDesign:{effect:EFFECTS.includes(sound.effect)?sound.effect:'none',at:clamp(sound.at ?? .1,0,90),music:sound.music!==false,reason:String(sound.reason || '').slice(0,300)} };
}
const normalize=text=>String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function groundMood(clip,cues) {
  const text=cues.filter(c=>c.end>clip.start&&c.start<clip.end).map(c=>c.text).join(' ');
  const evidence=normalize(clip.evidence),verified=evidence.length>=8&&normalize(text).includes(evidence);
  return {...clip,moodConfidence:verified?clip.moodConfidence:Math.min(.5,clip.moodConfidence),moodEvidenceVerified:verified,sourceHasMusic:/[\[(][^\])]*(?:music|song|singing)[^\])]*[\])]/i.test(text),messageContext:/\b(chat|discord|message|text|dm|notification|phone|ping)\b/i.test(text)};
}
const profiles={
  sad:{effects:['none'],music:'melancholy',level:.08},
  awkward:{effects:['rewind','rimshot','slide','error','record_stop','tick','sting','notification','none'],music:'mischief',level:.10},
  surprised:{effects:['bass_drop','rewind','pop','sting','tick','none'],music:'bounce',level:.12},
  playful:{effects:['rimshot','slide','pop','camera','notification','tick','none'],music:'mischief',level:.12},
  hype:{effects:['bass_drop','energy','impact','rewind','pop','whoosh','none'],music:'epic',level:.14},
  tense:{effects:['tick','camera','none'],music:'suspense',level:.08},
  warm:{effects:['sparkle','chime','none'],music:'lofi',level:.10},
  neutral:{effects:['none'],music:'ambient',level:.06}
};
export function resolveSound(settings,clip,used=new Set()) {
  const mood=MOODS.includes(clip.mood)?clip.mood:'neutral';
  let effect=settings.effects,background=settings.background,reason=settings.soundReason||'Manual sound settings';
  const confident=clip.moodConfidence>=.6;
  const profile=profiles[confident?mood:'neutral'];
  if(effect==='auto') {
    const options=(confident?profile.effects:['none']).filter(sound=>sound!=='notification'||clip.messageContext);
    const requested=clip.soundDesign?.effect;
    effect=confident&&options.includes(requested)?requested:options[0]||'none';
    if(effect!=='none'&&used.has(effect))effect=options.find(sound=>!used.has(sound))||'none';
    reason=confident?(effect===requested?(clip.soundDesign?.reason||`Matched to ${mood} mood`):effect==='none'?'Keep the original reaction without another repeated accent':`${effect.replaceAll('_',' ')} opening matched to ${mood} mood`):'Uncertain mood: keep the original reaction without an added hit';
    if(mood==='sad'){effect='none';reason='Sad moment: preserve the voice and pauses; no comic hit';}
  }
  if(background==='auto')background=clip.sourceHasMusic||clip.soundDesign?.music===false?'none':profile.music;
  const direction=clip.audioDirection?.verified&&clip.audioDirection.start===clip.start&&clip.audioDirection.end===clip.end?clip.audioDirection:null;
  let effectEvents=settings.effectEvents,musicEnergy=settings.musicEnergy||'steady',payoffAt=settings.payoffAt;
  let effectAt=settings.effects==='auto'?Math.max(0,Math.min(90,clip.end-clip.start-.4,clip.soundDesign?.at ?? .1)):settings.effectAt;
  if(direction&&direction.confidence>=.6){
    if(settings.background==='auto'){background=clip.sourceHasMusic||direction.hasMusic?'none':direction.background;musicEnergy=direction.energy;payoffAt=direction.payoffAt;}
    if(settings.effects==='auto'){
      effectEvents=mood==='sad'?[]:direction.events.filter(event=>event.effect!=='notification'||clip.messageContext);
      effectEvents=effectEvents.filter(event=>!used.has(event.effect)||effectEvents.length===1).slice(0,3);
      effect=effectEvents[0]?.effect||'none';effectAt=effectEvents[0]?.at||0;reason=direction.reason;
    }
  }
  return {...settings,effects:effect,effectEvents,background,musicEnergy,payoffAt,effectAt,effectVolume:settings.effects==='auto'?Math.min(settings.effectVolume,.45):settings.effectVolume,musicVolume:settings.background==='auto'?Math.min(settings.musicVolume,profile.level):settings.musicVolume,soundReason:reason,suggestedMood:mood};
}
const musicFamilies={sad:['cinematic','melancholy','lofi'],awkward:['mischief','bounce','playful'],surprised:['bounce','mischief','pulse'],playful:['mischief','hoedown','playful'],hype:['epic','bounce','pulse'],tense:['suspense','tension'],warm:['acoustic','lofi','ambient'],neutral:['lofi','ambient']};
export function planBatchSound(clips,settings,projectSeed=''){
  const used=new Set(),beds=new Set();return clips.map((clip,index)=>{
    const seed=settings.soundSeed||soundSeed(`${projectSeed}:${clip.id}:${clip.start}:${index}`);
    const soundPlan=resolveSound({...settings,soundSeed:seed},clip,used);
    if(settings.background==='auto'&&soundPlan.background!=='none'&&!(clip.audioDirection?.verified&&clip.audioDirection.confidence>=.6)){
      const family=musicFamilies[clip.moodConfidence>=.6?clip.mood:'neutral']||musicFamilies.neutral;
      const ordered=family.map((_,i)=>family[(i+seed%family.length)%family.length]);
      soundPlan.background=ordered.find(name=>!beds.has(name))||ordered[0];beds.add(soundPlan.background);
    }
    if(soundPlan.effects!=='none')used.add(soundPlan.effects);for(const event of soundPlan.effectEvents||[])used.add(event.effect);return {...clip,soundPlan};
  });
}
