export const MOODS = ['sad','awkward','surprised','playful','hype','tense','warm','neutral'];
export const MOMENTS = ['weird','sad','out_of_pocket','funny','hype','reflective','other'];
export const EFFECTS = ['none','notification','pop','tick','chime','sting','record_stop','whoosh','impact'];
export const FOCUSES = ['weird_sad_unexpected','weird','sad','out_of_pocket','balanced'];
const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number(n)||0));
export function editorialTags(input={}) {
  const sound=input.soundDesign || {};
  return { mood:MOODS.includes(input.mood)?input.mood:'neutral', momentType:MOMENTS.includes(input.momentType)?input.momentType:'other', moodConfidence:clamp(input.moodConfidence,0,1), moodReason:String(input.moodReason || '').slice(0,450), evidence:String(input.evidence || '').slice(0,240), endingQuote:String(input.endingQuote || '').slice(0,240),arcComplete:input.arcComplete===true,momentScore:clamp(input.momentScore ?? input.score,0,100), soundDesign:{effect:EFFECTS.includes(sound.effect)?sound.effect:'none',at:clamp(sound.at ?? .1,0,2),music:sound.music!==false,reason:String(sound.reason || '').slice(0,300)} };
}
const normalize=text=>String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function groundMood(clip,cues) {
  const text=cues.filter(c=>c.end>clip.start&&c.start<clip.end).map(c=>c.text).join(' ');
  const evidence=normalize(clip.evidence),verified=evidence.length>=8&&normalize(text).includes(evidence);
  return {...clip,moodConfidence:verified?clip.moodConfidence:Math.min(.5,clip.moodConfidence),moodEvidenceVerified:verified,sourceHasMusic:/[\[(][^\])]*(?:music|song|singing)[^\])]*[\])]/i.test(text),messageContext:/\b(chat|discord|message|text|dm|notification|phone|ping)\b/i.test(text)};
}
const profiles={
  sad:{effects:['none'],music:'melancholy',level:.08},
  awkward:{effects:['record_stop','tick','sting','notification','none'],music:'playful',level:.10},
  surprised:{effects:['pop','sting','tick','none'],music:'playful',level:.12},
  playful:{effects:['pop','notification','tick','none'],music:'playful',level:.12},
  hype:{effects:['impact','pop','whoosh','none'],music:'pulse',level:.14},
  tense:{effects:['tick','none'],music:'tension',level:.08},
  warm:{effects:['chime','none'],music:'ambient',level:.10},
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
  if(background==='auto')background=clip.sourceHasMusic?'none':profile.music;
  return {...settings,effects:effect,background,effectAt:settings.effects==='auto'?Math.min(2,clip.soundDesign?.at ?? .1):settings.effectAt,effectVolume:settings.effects==='auto'?Math.min(settings.effectVolume,.45):settings.effectVolume,musicVolume:settings.background==='auto'?Math.min(settings.musicVolume,profile.level):settings.musicVolume,soundReason:reason,suggestedMood:mood};
}
export function planBatchSound(clips,settings){const used=new Set();return clips.map(clip=>{const soundPlan=resolveSound(settings,clip,used);if(soundPlan.effects!=='none')used.add(soundPlan.effects);return {...clip,soundPlan};});}
