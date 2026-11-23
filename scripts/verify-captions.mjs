import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import ffmpeg from 'ffmpeg-static';
import { run, clipSrt, renderArgs, validateClips } from '../lib/core.mjs';
import { transcribe } from '../lib/transcribe.mjs';
import { analyze } from '../lib/ai.mjs';
const dir = resolve('data/caption-verification'); await mkdir(dir, { recursive: true });
const sample = resolve('data/verification/jfk.wav');
await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0x202a1c:size=640x360:rate=30', '-i', sample, '-c:v', 'libx264', '-c:a', 'aac', '-shortest', join(dir, 'source.mp4')]);
const result = await transcribe({ source: join(dir, 'source.mp4'), dir, duration: 10.56, ffmpeg, whisper: resolve('bin/whisper/Release/whisper-cli.exe'), model: resolve('bin/whisper/ggml-base-q5_1.bin') });
assert.ok(result.cues.length >= 2);
assert.match(result.cues.map(c => c.text).join(' '), /country/i);
assert.ok(result.cues.every(c => c.start >= 0 && c.end <= 10.56 && c.end > c.start));
await writeFile(join(dir, 'clip-1.srt'), clipSrt(result.cues, 0, 10.56));
await run(ffmpeg, renderArgs(join(dir, 'source.mp4'), { id: 'clip-1', start: 0, end: 10.56 }, { subtitleFilter: true }), { cwd: dir });
assert.ok((await stat(join(dir, 'clip-1.mp4'))).size > 1000);
console.log('PASS: Speech-only video transcribed locally, with bounded timestamps, downloadable SRT and a burned-caption MP4.');
if (process.argv.includes('--antigravity')) {
  const job = { id: 'caption-smoke', provider: 'antigravity', model: 'gemini-3.8-flash-high', count: 1, maxSeconds: 11, duration: 10.56 };
  const plan = await analyze({ job, dir, cues: result.cues, ffmpeg, source: join(dir, 'source.mp4') });
  assert.ok(validateClips(plan, 10.56, 1, 11).length);
  console.log('PASS: Generated speech captions are accepted by Antigravity to produce a valid clip plan, without a Gemini API key.');
}
