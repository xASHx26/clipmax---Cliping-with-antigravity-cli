// Give a finished sentence its natural ending rather than cutting at an
// arbitrary model timestamp. Semantic completeness is also required in the AI prompt.
export function completeClipEnd(clip, cues, duration, maxSeconds) {
  const endingCue=cues.find(cue=>cue.start<clip.end && cue.end>=clip.end-.03);
  const nonSpeech=endingCue && /^\s*[\[(].*[\])]\s*$/.test(endingCue.text);
  const candidates = cues.filter(cue => cue.end >= clip.end - (nonSpeech || !endingCue ? 4 : .05) && cue.end <= clip.end + 8 && cue.end <= clip.start + maxSeconds && /[.!?…。]["'”’)]*$/.test(cue.text.trim()));
  const sentence = candidates.sort((a,b)=>Math.abs(a.end-clip.end)-Math.abs(b.end-clip.end))[0];
  if (!sentence) {
    const clean=text=>String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const quote=clean(clip.endingQuote),tail=cues.filter(cue=>cue.end>clip.end-8&&cue.end<=clip.end+.03&&cue.start>=clip.start).map(c=>c.text).join(' ');
    const unfinished=/\b(and|but|because|if|when|although|that|to|a|the|of|for|with|i|im|then|so|or)$/i.test(clean(endingCue?.text));
    if(clip.arcComplete===true&&quote.length>=8&&endingCue&&Math.abs(endingCue.end-clip.end)<.04&&clean(tail).endsWith(quote)&&!unfinished)return {...clip,contextReviewNeeded:false};
    return { ...clip, contextReviewNeeded: true };
  }
  const next = cues.find(cue => cue.start >= sentence.end && cue !== sentence && !/^\s*[\[(].*[\])]\s*$/.test(cue.text));
  const end = Math.min(duration,clip.start+maxSeconds,sentence.end+.35,Math.max(sentence.end,next?.start ?? duration));
  return { ...clip, end, contextReviewNeeded: false };
}
