import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import { run } from './core.mjs';
import { mediaProgress, whisperProgress } from './progress.mjs';

export function whisperCues(result, duration) {
  if (!Array.isArray(result.transcription)) throw new Error('Speech engine returned an invalid transcript.');
  const cues = [];
  for (const item of result.transcription) {
    const start = Number(item.offsets?.from) / 1000, end = Number(item.offsets?.to) / 1000;
    const text = String(item.text || '').replace(/\[_[^\]]*\]/g, '').trim();
    if (!text || /^\[[^\]]+\]$/.test(text) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start >= duration) continue;
    // Discard repeated silence hallucinations without discarding ordinary repeated words.
    const previous = cues.at(-1);
    if (previous && previous.text === text && start - previous.end < 0.2) { previous.end = Math.min(duration, end); continue; }
    cues.push({ start, end: Math.min(duration, end), text });
  }
  return cues;
}

export async function transcribe({ source, dir, duration, ffmpeg, whisper, model, language = 'auto', onProgress = () => {} }) {
  try { await access(whisper); await access(model); }
  catch { throw new Error('The local AI caption engine is missing. Install the latest Clipmax desktop build, which includes the speech model.'); }
  const wav = join(dir, 'speech.wav'), output = join(dir, 'speech');
  onProgress({ percent: null, message: 'Preparing audio for speech recognition' });
  await run(ffmpeg, ['-y', '-i', source, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-progress', 'pipe:1', '-nostats', wav], { timeout: 600000, onLine: mediaProgress(duration, progress => onProgress({ ...progress, percent: null, message: 'Preparing audio' })) });
  onProgress({ percent: 0, message: 'Transcribing speech locally', mediaSeconds: 0, mediaTotal: duration });
  // Independent chunks prevent an intro containing music/blank audio from
  // poisoning the transcription context for the remainder of a long stream.
  const chunkSeconds = 60, count = Math.ceil(duration / chunkSeconds), cues = [];
  let detectedLanguage = language;
  for (let index = 0; index < count; index++) {
    const start = index * chunkSeconds, length = Math.min(chunkSeconds, duration - start);
    const chunk = join(dir, `speech-part-${index}.wav`), prefix = `${output}-part-${index}`;
    await run(ffmpeg, ['-y', '-ss', String(start), '-i', wav, '-t', String(length), '-c:a', 'pcm_s16le', chunk], { timeout: 120000 });
    const message = `Transcribing audio section ${index + 1}/${count}`;
    onProgress({ percent: start / duration * 100, mediaSeconds: start, mediaTotal: duration, bytes: null, message });
    await run(whisper, ['-m', model, '-f', chunk, '-l', language, '-mc', '0', '-t', String(Math.max(1, Math.min(8, availableParallelism() - 1))), '-ng', '-ml', '42', '-sow', '-pp', '-oj', '-osrt', '-of', prefix], { cwd: dir, timeout: Math.max(180000, length * 3000), onLine: whisperProgress(progress => onProgress({ percent: (start + length * progress.percent / 100) / duration * 100, mediaSeconds: start + length * progress.percent / 100, mediaTotal: duration, message })) });
    const result = JSON.parse(await readFile(`${prefix}.json`, 'utf8'));
    const part = whisperCues(result, length);
    if (part.length) detectedLanguage = result.result?.language || detectedLanguage;
    cues.push(...part.map(cue => ({ ...cue, start: cue.start + start, end: cue.end + start })));
    onProgress({ percent: Math.min(99.9, (start + length) / duration * 100), mediaSeconds: start + length, mediaTotal: duration, message });
  }
  if (!cues.length) throw new Error('AI could not detect usable speech in this section. Choose a section with clear speech and retry.');
  return { cues, language: detectedLanguage };
}
