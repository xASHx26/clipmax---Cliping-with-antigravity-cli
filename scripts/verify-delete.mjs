import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const dir = await mkdtemp(join(tmpdir(), 'clipmax-delete-api-')), id = randomUUID();
await mkdir(join(dir, id)); await writeFile(join(dir, id, 'job.json'), JSON.stringify({ id, status: 'ready', title: 'Deletion test', createdAt: new Date().toISOString(), clips: [] }));
await writeFile(join(dir, id, 'export.mp4'), 'retained-export');
const child = spawn(process.execPath, ['server.mjs'], { cwd: resolve('.'), env: { ...process.env, PORT: '4395', CLIPMAX_DATA_DIR: dir, CLIPMAX_SETTINGS_DIR: dir, CLIPMAX_VAULT_KEY: '' }, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
try {
  await new Promise((resolve,reject) => { const timer=setTimeout(()=>reject(new Error('Startup timeout')),10000); child.stdout.on('data',d=>{if(d.toString().includes('Clipmax Studio:')){clearTimeout(timer);resolve();}});child.once('error',reject); });
  const base='http://127.0.0.1:4395';
  const removed=await fetch(`${base}/api/jobs/${id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'}); assert.equal(removed.status,200);
  const {undoId}=await removed.json(); assert.equal((await (await fetch(`${base}/api/jobs`)).json()).length,0);
  assert.equal(await readFile(join(dir,'.trash',undoId,'export.mp4'),'utf8'),'retained-export');
  const restored=await fetch(`${base}/api/trash/${undoId}/restore`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); assert.equal(restored.status,200);
  assert.equal((await (await fetch(`${base}/api/jobs`)).json()).length,1);
  assert.equal(await readFile(join(dir,id,'export.mp4'),'utf8'),'retained-export');
  console.log('PASS: Project API deletion removes the project from the list; Undo restores its metadata and exported files.');
} finally { child.kill(); await new Promise(r=>child.once('exit',r)); assert.ok(dir.startsWith(join(tmpdir(),'clipmax-delete-api-'))); await rm(dir,{recursive:true,force:true}); }
