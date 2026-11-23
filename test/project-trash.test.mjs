import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectBusy, trashProject, restoreProject } from '../lib/project-trash.mjs';
test('project deletion moves media to trash and Undo restores the same files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clipmax-trash-test-')), id = randomUUID();
  try {
    await mkdir(join(root, id)); await writeFile(join(root, id, 'job.json'), JSON.stringify({ id, status: 'ready', clips: [] }));
    await writeFile(join(root, id, 'clip-1.mp4'), 'export');
    const undoId = await trashProject(root, id);
    await assert.rejects(access(join(root, id)));
    assert.equal(await readFile(join(root, '.trash', undoId, 'clip-1.mp4'), 'utf8'), 'export');
    const job = await restoreProject(root, undoId);
    assert.equal(job.id, id); assert.equal(await readFile(join(root, id, 'clip-1.mp4'), 'utf8'), 'export');
    await assert.rejects(trashProject(root, '../outside'), /Invalid/);
    await assert.rejects(restoreProject(root, '../../outside'), /Invalid/);
  } finally { assert.ok(root.startsWith(join(tmpdir(), 'clipmax-trash-test-'))); await rm(root, { recursive: true, force: true }); }
});
test('processing, editing and upload jobs are protected from deletion', () => {
  assert.equal(projectBusy({ status: 'ready' }), false);
  assert.equal(projectBusy({ status: 'failed' }), false);
  assert.equal(projectBusy({ status: 'queued' }), true);
  assert.equal(projectBusy({ status: 'transcribing' }), true);
  assert.equal(projectBusy({ status: 'ready', publishing: true }), true);
  assert.equal(projectBusy({ status: 'ready', editing: true }), true);
});
