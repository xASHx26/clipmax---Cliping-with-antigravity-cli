import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
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
  const call=(path,method,body)=>fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await call(`/api/jobs/${id}`,'DELETE',{})).status,400);
  assert.equal(await readFile(join(dir,id,'export.mp4'),'utf8'),'retained-export');
  assert.equal((await call(`/api/jobs/${id}/delete-confirmation`,'POST',{confirmed:false})).status,400);
  const challenge=await call(`/api/jobs/${id}/delete-confirmation`,'POST',{confirmed:true});assert.equal(challenge.status,200);
  const {confirmation}=await challenge.json();
  assert.equal((await call(`/api/jobs/${id}`,'DELETE',{confirmation,confirmationText:'wrong'})).status,400);
  assert.equal(await readFile(join(dir,id,'export.mp4'),'utf8'),'retained-export');
  const removed=await call(`/api/jobs/${id}`,'DELETE',{confirmation,confirmationText:'DELETE'});assert.equal(removed.status,200);assert.equal((await removed.json()).permanent,true);
  assert.equal((await (await fetch(`${base}/api/jobs`)).json()).length,0);
  await assert.rejects(access(join(dir,id)),{code:'ENOENT'});await assert.rejects(access(join(dir,'.trash')),{code:'ENOENT'});
  console.log('PASS: Both confirmations are required; cancelling or incorrect text preserves files; confirmed deletion permanently removes the whole project without trash.');
} finally { child.kill(); await new Promise(r=>child.once('exit',r)); assert.ok(dir.startsWith(join(tmpdir(),'clipmax-delete-api-'))); await rm(dir,{recursive:true,force:true}); }
