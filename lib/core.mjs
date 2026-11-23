import { spawn } from 'node:child_process';
import { editorialTags } from './mood.mjs';

export function validateSource(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  // Use known video services only; no arbitrary server-side URL fetching.
  const allowed = ['youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com', 'facebook.com', 'fb.watch', 'instagram.com', 'twitch.tv'];
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed.some(d => host === d || host.endsWith(`.${d}`))) {
    throw new Error('Use an HTTPS YouTube, Twitch, Vimeo, TikTok, Facebook, or Instagram video URL.');
  }
  if (host === 'm.twitch.tv') url.hostname = 'www.twitch.tv';
  return url.href;
}

export function importWindow(duration, start = 0, minutes = 30) {
  if (!Number.isFinite(duration) || duration < 5) throw new Error('The source must be a recorded video at least 5 seconds long.');
  if (!Number.isFinite(start) || start < 0 || start >= duration - 4) throw new Error('Scan start must be before the last 5 seconds of the video.');
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) throw new Error('Choose a scan length between 1 and 120 minutes.');
  return { start, end: Math.min(duration, start + minutes * 60), duration: Math.min(duration - start, minutes * 60) };
}

export function run(command, args, { cwd, timeout = 900000, input, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', timedOut = false;
    const stop = () => {
      if(process.platform === 'win32' && child.pid && child.exitCode === null) spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).once('error',()=>child.kill());
      else child.kill();
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    const partial = { stdout: '', stderr: '' };
    const lines = (data, stream, flush = false) => {
      if (!onLine) return;
      partial[stream] += data;
      const chunks = partial[stream].split(/[\r\n]+/);
      partial[stream] = flush ? '' : chunks.pop();
      for (const line of chunks) if (line) { try { onLine(line, stream); } catch (e) { stop(); reject(e); } }
      if (partial[stream].length > 32000) partial[stream] = partial[stream].slice(-32000);
    };
    child.stdout.on('data', d => { out = (out + d).slice(-6000000); lines(d.toString(), 'stdout'); });
    child.stderr.on('data', d => { err = (err + d).slice(-30000); lines(d.toString(), 'stderr'); });
    child.on('error', e => { clearTimeout(timer); reject(new Error(`${command} could not start: ${e.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      lines('', 'stdout', true); lines('', 'stderr', true);
      if (timedOut) reject(new Error('The operation timed out. Try a shorter source video.'));
      else if (code !== 0) reject(new Error(`${command} failed: ${(err || out).slice(-1800)}`));
      else resolve(out);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export function parseJson(text) {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(clean); } catch {}
  const begin = clean.indexOf('{'), end = clean.lastIndexOf('}');
  if (begin < 0 || end < begin) throw new Error('AI returned no JSON clip plan.');
  return JSON.parse(clean.slice(begin, end + 1));
}

export function validateClips(plan, duration, count, maxSeconds) {
  if (!Array.isArray(plan.clips) || !plan.clips.length) throw new Error('AI did not find any usable moments.');
  const result = plan.clips.slice(0, count).map((clip, i) => {
    const start = Number(clip.start), end = Number(clip.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration + 0.1 || end - start < 5 || end - start > maxSeconds + 0.1) throw new Error(`AI clip ${i + 1} has invalid timestamps. Try again.`);
    return { id: `clip-${i + 1}`, start, end, title: String(clip.title || `Clip ${i + 1}`).slice(0, 100), caption: String(clip.caption || '').slice(0, 2000), reason: String(clip.reason || ''), score: Math.max(0, Math.min(100, Number(clip.score) || 0)), ...editorialTags(clip), selected: true, publications: {} };
  });
  return result;
}

function seconds(s) { return s.split(':').reduce((a, v) => a * 60 + Number(v), 0); }
export function parseVtt(text) {
  const cues = [];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const i = lines.findIndex(x => x.includes(' --> '));
    if (i < 0) continue;
    const [start, end] = lines[i].split(' --> ');
    const value = lines.slice(i + 1).join(' ').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (value) cues.push({ start: seconds(start), end: seconds(end.split(' ')[0]), text: value });
  }
  // Auto captions often repeat the preceding line in the next rolling cue.
  return cues.filter((c, i) => !i || c.text !== cues[i - 1].text);
}
function srtTime(s) {
  const ms = Math.round(Math.max(0, s) * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
export function clipSrt(cues, start, end) {
  return cues.filter(c => c.end > start && c.start < end).map((c, i) => `${i + 1}\n${srtTime(Math.max(c.start, start) - start)} --> ${srtTime(Math.min(c.end, end) - start)}\n${c.text}\n`).join('\n');
}

export function renderArgs(source, clip, { aspect = '9:16', captions = true, subtitleFilter = false, framing, audioFile } = {}) {
  const size = aspect === '1:1' ? '1080:1080' : aspect === '16:9' ? '1920:1080' : '1080:1920';
  let filter = `scale=${size}:force_original_aspect_ratio=increase,crop=${size},setsar=1`;
  if (framing && framing.mode !== 'center') {
    const [width,height] = size.split(':').map(Number);
    if (framing.mode === 'streamer' && framing.webcam && aspect === '9:16') {
      const b = framing.webcam, top = 640;
      const contentWidth=Math.max(.5,Math.min(1,framing.contentWidth || .6));
      filter = `split=2[cam][scene];[cam]crop=trunc(iw*${b.w}/2)*2:trunc(ih*${b.h}/2)*2:trunc(iw*${b.x}/2)*2:trunc(ih*${b.y}/2)*2,scale=${width}:${top}:force_original_aspect_ratio=decrease,pad=${width}:${top}:(ow-iw)/2:(oh-ih)/2:color=0x101410[face];[scene]crop=trunc(iw*${contentWidth}/2)*2:ih:(iw-ow)/2:0,scale=${width}:${height-top}:force_original_aspect_ratio=decrease,pad=${width}:${height-top}:(ow-iw)/2:(oh-ih)/2:color=0x101410[content];[face][content]vstack=inputs=2,setsar=1`;
    } else filter = `split=2[bg][fg];[bg]scale=${size}:force_original_aspect_ratio=increase,crop=${size},boxblur=24:2[blur];[fg]scale=${size}:force_original_aspect_ratio=decrease[front];[blur][front]overlay=(W-w)/2:(H-h)/2,setsar=1`;
  }
  if (captions && subtitleFilter) filter += `,subtitles=${clip.id}.srt:force_style='FontName=Arial,FontSize=12,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Alignment=2,MarginV=24'`;
  const complex = Boolean(framing && framing.mode !== 'center');
  return ['-y', '-ss', String(clip.start), '-i', source, ...(audioFile ? ['-i',audioFile] : []), '-t', String(clip.end - clip.start), '-map', complex ? '[vout]' : '0:v:0', '-map', audioFile ? '1:a:0' : '0:a:0?', complex ? '-filter_complex' : '-vf', complex ? `[0:v]${filter}[vout]` : filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', `${clip.id}.mp4`];
}
