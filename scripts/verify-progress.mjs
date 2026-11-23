import http from 'node:http';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import ffmpeg from 'ffmpeg-static';
import { run } from '../lib/core.mjs';
import { mediaProgress } from '../lib/progress.mjs';
import { transcribe } from '../lib/transcribe.mjs';
import { uploadBytes } from '../lib/upload-progress.mjs';

const dir = resolve('data/progress-verification'); await mkdir(dir, { recursive: true });
const frames = [];
await run(ffmpeg, ['-y', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=4', '-c:v', 'libx264', '-progress', 'pipe:1', '-nostats', resolve(dir, 'video.mp4')], { onLine: mediaProgress(4, value => frames.push(value)) });
assert.ok(frames.length >= 3, 'Expected multiple real FFmpeg progress events');
assert.ok(frames.some(p => p.percent > 0 && p.percent < 99));
console.log(`PASS: ${frames.length} actual FFmpeg timestamp updates advance the progress bar.`);

const captions = [];
await transcribe({ source: resolve('data/verification/jfk.wav'), dir, duration: 10.56, ffmpeg, whisper: resolve('bin/whisper/Release/whisper-cli.exe'), model: resolve('bin/whisper/ggml-base-q5_1.bin'), onProgress: value => captions.push(value) });
assert.ok(captions.some(p => Number.isFinite(p.percent) && p.percent > 0), 'Expected real speech recognition progress');
console.log('PASS: Whisper emits measured transcription progress.');

let received = 0;
const server = http.createServer((req, res) => { req.on('data', bytes => { received += bytes.length; }); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"accepted":true}'); }); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const body = Buffer.alloc(1024 * 1024, 7), events = [];
  const result = await uploadBytes(`http://127.0.0.1:${server.address().port}/upload`, { body, headers: {}, onProgress: p => events.push(p) });
  assert.equal(result.status, 200); assert.equal(received, body.length);
  assert.equal(events.at(-1).bytes, body.length);
  assert.ok(events.some(p => p.percent > 0 && p.percent < 99));
  assert.ok(events.every(p => p.percent < 100));
  console.log('PASS: Upload progress follows actual request writes and never reports accepted before the server responds.');
} finally { await new Promise(resolve => server.close(resolve)); }
