import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../lib/core.mjs';
import { cancellationError, withCancellation, taskSignal, requestSignal } from '../lib/cancellation.mjs';

test('cancelling an active media process waits for its process tree to exit', async () => {
  const controller=new AbortController(); let descendant;
  const code=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'inherit',windowsHide:true});console.log(child.pid);setTimeout(()=>{},30000);`;
  await assert.rejects(withCancellation(controller.signal,()=>run(process.execPath,['-e',code],{onLine:line=>{if(/^\d+$/.test(line)){descendant=Number(line);controller.abort(cancellationError());}}})),error=>error.code==='PROJECT_CANCELLED');
  assert.ok(descendant);
  for(let i=0;i<40;i++){try{process.kill(descendant,0);}catch{break;}await new Promise(resolve=>setTimeout(resolve,25));}
  assert.throws(()=>process.kill(descendant,0));
});
test('pre-cancelled work never spawns; parallel projects keep independent cancellation scopes', async () => {
  const first=new AbortController(),second=new AbortController();first.abort(cancellationError());
  const values=await Promise.allSettled([
    withCancellation(first.signal,()=>run('this-command-must-never-start',[])),
    withCancellation(second.signal,async()=>{assert.equal(taskSignal(),second.signal);assert.equal(requestSignal(1000).aborted,false);return run(process.execPath,['-e',"console.log('other project completed')"]);})
  ]);
  assert.equal(values[0].reason.code,'PROJECT_CANCELLED');assert.equal(values[1].value.trim(),'other project completed');assert.equal(taskSignal(),undefined);
});
