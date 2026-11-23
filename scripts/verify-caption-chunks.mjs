import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { run } from '../lib/core.mjs';
import { transcribe } from '../lib/transcribe.mjs';

// Reproduce the failure mode: a long silent intro must not suppress later speech.
const dir = resolve('data/caption-chunk-verification');
await mkdir(dir, { recursive: true });
const source = join(dir, 'silence-then-speech.wav');
await run(ffmpeg, ['-y', '-f', 'lavfi', '-t', '65', '-i', 'anullsrc=r=16000:cl=mono', '-i', resolve('data/verification/jfk.wav'), '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[out]', '-map', '[out]', source]);
const progress = [];
const result = await transcribe({ source, dir, duration: 75.56, ffmpeg, whisper: resolve('bin/whisper/Release/whisper-cli.exe'), model: resolve('bin/whisper/ggml-base-q5_1.bin'), onProgress: value => progress.push(value) });
assert.match(result.cues.map(c => c.text).join(' '), /country/i);
assert.ok(result.cues.some(c => c.start >= 65), 'Speech timestamps must include the chunk offset.');
assert.ok(result.cues.every(c => c.start >= 0 && c.end <= 75.56 && c.end > c.start));
assert.ok(progress.some(p => p.percent > 0 && p.percent < 100));
console.log('PASS: Speech after a 65-second silent intro is transcribed, with correct global timestamps and measured progress.');
