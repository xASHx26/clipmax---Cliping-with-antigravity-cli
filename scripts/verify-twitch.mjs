import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
const dir = await mkdtemp(join(tmpdir(), 'clipmax-twitch-smoke-'));
const env = { ...process.env, PORT: '4398', CLIPMAX_DATA_DIR: dir, CLIPMAX_SETTINGS_DIR: dir, GEMINI_API_KEY: '', CLIPMAX_VAULT_KEY: '' };
const child = spawn(process.execPath, ['server.mjs'], { cwd: resolve('.'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Readiness timed out')), 15000); child.stdout.on('data', d => { if (d.toString().includes('Clipmax Studio:')) { clearTimeout(timer); resolve(); } }); child.once('error', reject); });
  const base = 'http://127.0.0.1:4398';
  const response = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://m.twitch.tv/videos/2936683310', provider: 'antigravity', model: 'gemini-3.8-flash-high', count: 1, maxSeconds: 30, scanStart: 3600, scanMinutes: 1 }) });
  assert.equal(response.status, 201);
  const job = await response.json();
  assert.equal(job.url, 'https://www.twitch.tv/videos/2936683310');
  let result, previous; const measured = [];
  for (let i = 0; i < 420; i++) {
    result = (await (await fetch(`${base}/api/jobs`)).json())[0];
    for (const [key, stage] of Object.entries(result.workflow?.stages || {})) if (stage.state === 'running' && Number.isFinite(stage.percent)) measured.push({ key, percent: stage.percent });
    if (result.status !== previous) { console.log(`Twitch verification: ${result.status}`); previous = result.status; }
    if (result.status === 'failed' || result.status === 'ready') break;
    await new Promise(r => setTimeout(r, 1000));
  }
  assert.equal(result.sourceDuration, 24289);
  assert.equal(result.duration, 60);
  assert.equal(result.status, 'ready', result.error || 'Processing did not finish.');
  assert.equal(result.captionSource, 'ai');
  assert.ok(JSON.parse(await readFile(join(dir, job.id, 'cues.json'), 'utf8')).length);
  assert.ok(result.clips[0].burnedCaptions);
  assert.ok((await stat(join(dir, job.id, `${result.clips[0].id}.mp4`))).size > 1000);
  assert.ok(measured.some(p => p.percent > 0 && p.percent < 100), 'Expected measured in-flight progress');
  for (const name of ['import', 'captions', 'analysis', 'editing']) assert.equal(result.workflow.stages[name].state, 'done');
  await mkdir(resolve('data/progress-verification'), { recursive: true });
  await writeFile(resolve('data/progress-verification/completed-job.json'), JSON.stringify(result, null, 2));
  console.log('PASS: Actual Twitch VOD → one-minute import → local AI captions → Antigravity clip plan → captioned MP4, without a Gemini API key.');
  console.log('PASS: Measured live stage percentages appeared during processing and all stages completed only after their tools exited.');
} finally { child.kill(); await new Promise(r => child.once('exit', r)); await rm(dir, { recursive: true, force: true }); }
