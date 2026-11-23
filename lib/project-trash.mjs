import { mkdir, rename, readFile, access } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';

const validId = /^[a-f0-9-]{36}$/;
function within(root, ...parts) {
  const path = resolve(root, ...parts), distance = relative(resolve(root), path);
  if (!distance || distance.startsWith('..') || isAbsolute(distance)) throw new Error('Invalid project storage path.');
  return path;
}
export function projectBusy(job) {
  return Boolean(job.deleting || job.publishing || job.editing || ['queued', 'importing', 'transcribing', 'analyzing', 'rendering'].includes(job.status));
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
