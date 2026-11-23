import assert from 'node:assert/strict';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { run, renderArgs } from '../lib/core.mjs';

const dir = resolve('data', 'verification'); await mkdir(dir, { recursive: true });
await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(dir, 'source.mp4')]);
await writeFile(join(dir, 'clip-1.srt'), '1\n00:00:00,000 --> 00:00:05,000\nClipmax render verification\n');
await run(ffmpeg, renderArgs(join(dir, 'source.mp4'), { id: 'clip-1', start: 0, end: 5 }, { subtitleFilter: true }), { cwd: dir });
assert.ok((await stat(join(dir, 'clip-1.mp4'))).size > 1000);
await run(ffmpeg, ['-v', 'error', '-i', join(dir, 'clip-1.mp4'), '-f', 'null', '-']);
console.log('PASS: Actual vertical H.264/AAC export with burned subtitles decodes successfully.');

const child = spawn(process.execPath, ['server.mjs'], { cwd: resolve('.'), env: { ...process.env, PORT: '4397', CLIPMAX_DATA_DIR: join(dir, 'projects') }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Server readiness timed out')), 15000); child.stdout.on('data', d => { if (d.toString().includes('Clipmax Studio:')) { clearTimeout(timer); resolve(); } }); child.once('error', reject); child.once('exit', () => reject(new Error('Server exited'))); });
  const base = 'http://127.0.0.1:4397';
  assert.equal((await fetch(base)).status, 200);
  const info = await (await fetch(`${base}/api/status`)).json();
  assert.ok(info.connections);
  assert.deepEqual((await (await fetch(`${base}/api/connections`)).json()).accounts, []);
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://127.0.0.1/private' }) };
  assert.equal((await fetch(`${base}/api/jobs`, options)).status, 400);
  const automatic = await fetch(`${base}/api/jobs`, { ...options, body: JSON.stringify({ url: 'https://youtu.be/test', autoUpload: { enabled: true, consent: true, platforms: ['youtube'] } }) });
  assert.equal(automatic.status, 400);
  assert.match((await automatic.json()).error, /verified youtube API account/);
  assert.equal((await fetch(`${base}/api/jobs`, { ...options, headers: { ...options.headers, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(`${base}/media/../../.env`)).status, 404);
  assert.deepEqual(await (await fetch(`${base}/api/jobs`)).json(), []);
  const oauth = await (await fetch(`${base}/api/oauth/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: 'youtube', clientId: 'local-smoke-test-only' }) })).json();
  assert.equal(new URL(oauth.url).hostname, 'accounts.google.com');
  assert.ok(!JSON.stringify(oauth).includes('clientSecret'));
  assert.equal((await fetch(`${base}/oauth/callback/youtube?state=invalid&code=test`)).status, 400);
  console.log('PASS: App serves successfully; invalid sources, cross-origin writes and private file access are rejected.');
} finally { child.kill(); }
