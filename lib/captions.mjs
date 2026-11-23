export const CAPTION_STYLES = ['kinetic', 'highlight', 'clean'];
const assTime = seconds => {
  const cs = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
// Transcript text must never become an ASS override or drawing command.
const escape = text => String(text).replace(/[{}\\]/g, '').replace(/[\r\n]+/g, ' ');

export function captionWords(cue) {
  if (cue.words?.length) {
    const words = cue.words.filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && w.start >= cue.start - .1 && w.end <= cue.end + .1);
    if (words.length) return words.map(w => ({ ...w, text: escape(w.text) }));
  }
  const text = escape(cue.text).trim();
  if (!text) return [];
  let tokens = text.match(/\S+/gu) || [];
  // Keep unspaced scripts and unusually long words inside the safe caption area.
  tokens = tokens.flatMap(word => Array.from(word).length > 22 ? word.match(/.{1,16}/gu) : [word]);
  const total = tokens.reduce((sum, token) => sum + Math.max(2, Array.from(token).length), 0);
  let cursor = cue.start;
  return tokens.map((text, i) => {
    const end = i === tokens.length - 1 ? cue.end : cursor + (cue.end - cue.start) * Math.max(2, Array.from(text).length) / total;
    const word = { text, start: cursor, end }; cursor = end; return word;
  });
}

export function clipAss(cues, start, end, { aspect = '9:16', style = 'kinetic' } = {}) {
  if (!CAPTION_STYLES.includes(style)) style = 'kinetic';
  const [width, height] = aspect === '16:9' ? [1920,1080] : aspect === '1:1' ? [1080,1080] : [1080,1920];
  const font = aspect === '16:9' ? 62 : 68, y = Math.round(height * .74), x = width / 2;
  const events = [];
  let previousEnd = 0;
  const emit = (a, b, text, motion) => {
    a = Math.max(0, a - start, previousEnd); b = Math.min(end - start, b - start);
    if (b - a < .015 || !text) return;
    previousEnd = b;
    const duration = (b - a) * 1000, entrance = Math.min(85, Math.floor(duration / 3));
    const units=Array.from(text.replace(/\{[^}]*\}/g,'')).reduce((n,c)=>n+(/[MW@#%\p{Script=Han}]/u.test(c)?1:/[il.,' ]/.test(c)?.3:.6),0);
    const fit=Math.max(24,Math.min(font,Math.floor(width*.82/Math.max(1,units)/1.08)));
    const tags = motion ? `\\move(${x},${y+10},${x},${y},0,${entrance})\\fscx108\\fscy108\\t(0,${entrance},\\fscx100\\fscy100)\\fad(20,25)` : `\\pos(${x},${y})`;
    events.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Caption,,0,0,0,,{\\fs${fit}${tags}}${text}`);
  };
  for (const cue of [...cues].sort((a,b) => a.start - b.start)) {
    if (cue.end <= start || cue.start >= end) continue;
    const words = captionWords(cue).filter(word => word.end > start && word.start < end);
    for (let index = 0; index < words.length;) {
      const group = []; let length = 0;
      while (index < words.length && group.length < 4 && (!group.length || length + words[index].text.length < 24)) {
        const word = words[index++]; group.push(word); length += word.text.length + 1;
        if (/[.!?。！？]$/.test(word.text)) break;
      }
      if (style === 'clean') emit(group[0].start, group.at(-1).end, group.map(w => w.text).join(' '), false);
      else group.forEach((word, active) => {
        const text = group.map((w,i) => i === active ? `{\\1c&H6BE5FF&\\bord5}${w.text}{\\1c&HFFFFFF&\\bord4}` : w.text).join(' ');
        emit(word.start, active < group.length-1 ? group[active+1].start : word.end, text, style === 'kinetic');
      });
    }
  }
  if (!events.length) return '';
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,DejaVu Sans,${font},&H00FFFFFF,&H006BE5FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,5,90,90,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join('\n')}\n`;
}
