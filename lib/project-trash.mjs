import { mkdir, rename, readFile, access, lstat, realpath, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const validId = /^[a-f0-9-]{36}$/;
function within(root, ...parts) {
  const path = resolve(root, ...parts), distance = relative(resolve(root), path);
  if (!distance || distance.startsWith('..') || isAbsolute(distance)) throw new Error('Invalid project storage path.');
  return path;
}
export function projectBusy(job) {
  return Boolean(job.cancelling || job.deleting || job.publishing || job.editing || ['queued', 'importing', 'transcribing', 'analyzing', 'rendering'].includes(job.status));
}
export class DeletionConfirmations {
  constructor(now=Date.now) { this.now=now;this.pending=new Map(); }
  begin(id, confirmed) {
    if(!validId.test(id)||confirmed!==true)throw new Error('Confirm that you want to delete this project first.');
    const now=this.now();for(const [key,value] of this.pending)if(value.expiresAt<=now)this.pending.delete(key);
    const token=randomBytes(32).toString('hex');this.pending.set(id,{token,expiresAt:now+120000});return token;
  }
  consume(id, input) {
    const saved=this.pending.get(id),token=input?.confirmation;
    if(input?.confirmationText!=='DELETE'||!saved||saved.expiresAt<=this.now()||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||!timingSafeEqual(Buffer.from(saved.token),Buffer.from(token)))throw new Error('Complete both deletion confirmations again. The confirmation may have expired.');
    this.pending.delete(id);
  }
}
export async function deleteProjectPermanently(dataDir, id) {
  if(!validId.test(id))throw new Error('Invalid project ID.');
  const root=await realpath(resolve(dataDir)),source=within(root,id),info=await lstat(source);
  if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Refusing to delete a linked or invalid project folder.');
  const actual=await realpath(source),distance=relative(root,actual);
  if(!distance||distance.startsWith('..')||isAbsolute(distance)||resolve(actual)!==resolve(source))throw new Error('Project folder is outside project storage.');
  await rm(actual,{recursive:true,force:false,maxRetries:3,retryDelay:150});
}
export async function trashProject(dataDir, id) {
  if (!validId.test(id)) throw new Error('Invalid project ID.');
  const source = within(dataDir, id), trash = within(dataDir, '.trash');
  const undoId = `${id}--${Date.now()}`;
  const target = within(trash, undoId);
  await mkdir(trash, { recursive: true });
  await rename(source, target);
  return undoId;
}
export async function restoreProject(dataDir, undoId) {
  if (!/^[a-f0-9-]{36}--\d{13}$/.test(undoId)) throw new Error('Invalid undo ID.');
  const id = undoId.split('--')[0], source = within(dataDir, '.trash', undoId), target = within(dataDir, id);
  const job = JSON.parse(await readFile(resolve(source, 'job.json'), 'utf8'));
  if (job.id !== id) throw new Error('Stored project ID does not match.');
  try { await access(target); throw new Error('This project is already restored.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rename(source, target); delete job.deleting;
  return job;
}
