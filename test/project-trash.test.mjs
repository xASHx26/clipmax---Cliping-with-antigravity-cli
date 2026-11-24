import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectBusy, trashProject, restoreProject, deleteProjectPermanently, DeletionConfirmations } from '../lib/project-trash.mjs';
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
test('permanent deletion removes source, clips, captions and working files while preserving other projects',async()=>{
 const root=await mkdtemp(join(tmpdir(),'clipmax-permanent-test-')),id=randomUUID(),other=randomUUID();
 try{await mkdir(join(root,id,'work'),{recursive:true});await mkdir(join(root,other));
 for(const name of ['source.mp4','clip-1.mp4','clip-1.srt','clip-1.ass','cues.json','job.json','work/audio.wav'])await writeFile(join(root,id,name),'fixture');
 await writeFile(join(root,other,'source.mp4'),'keep');
 await deleteProjectPermanently(root,id);await assert.rejects(access(join(root,id)),{code:'ENOENT'});
 assert.equal(await readFile(join(root,other,'source.mp4'),'utf8'),'keep');await assert.rejects(access(join(root,'.trash')),{code:'ENOENT'});
 for(const bad of ['..','../outside','',root])await assert.rejects(deleteProjectPermanently(root,bad),/Invalid/);
 }finally{assert.ok(root.startsWith(join(tmpdir(),'clipmax-permanent-test-')));await rm(root,{recursive:true,force:true});}
});
test('permanent deletion rejects linked project roots and never follows a nested junction outside storage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'clipmax-links-test-')),id=randomUUID(),linked=randomUUID(),outside=join(root,'outside'),projects=join(root,'projects');
 try{await mkdir(outside);await writeFile(join(outside,'keep.txt'),'keep');await mkdir(join(projects,id),{recursive:true});
 await symlink(outside,join(projects,id,'nested-link'),process.platform==='win32'?'junction':'dir');
 await symlink(outside,join(projects,linked),process.platform==='win32'?'junction':'dir');
 await assert.rejects(deleteProjectPermanently(projects,linked),/linked/);
 await deleteProjectPermanently(projects,id);assert.equal(await readFile(join(outside,'keep.txt'),'utf8'),'keep');
 }finally{assert.ok(root.startsWith(join(tmpdir(),'clipmax-links-test-')));await rm(root,{recursive:true,force:true});}
});
test('two-step deletion confirmation is project-bound, expires, and cannot be replayed',()=>{
 let now=1000;const confirmations=new DeletionConfirmations(()=>now),id=randomUUID(),other=randomUUID();
 assert.throws(()=>confirmations.begin(id,false),/Confirm/);
 const token=confirmations.begin(id,true);
 assert.throws(()=>confirmations.consume(other,{confirmation:token,confirmationText:'DELETE'}),/both/);
 assert.throws(()=>confirmations.consume(id,{confirmation:token,confirmationText:'delete'}),/both/);
 confirmations.consume(id,{confirmation:token,confirmationText:'DELETE'});
 assert.throws(()=>confirmations.consume(id,{confirmation:token,confirmationText:'DELETE'}),/both/);
 const expired=confirmations.begin(id,true);now+=120001;
 assert.throws(()=>confirmations.consume(id,{confirmation:expired,confirmationText:'DELETE'}),/expired/);
});
