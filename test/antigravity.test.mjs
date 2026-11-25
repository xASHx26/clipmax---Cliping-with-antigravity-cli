import test from 'node:test';import assert from 'node:assert/strict';import {resolve} from 'node:path';import {agyResult,mediaReadPaths} from '../lib/antigravity.mjs';
test('Antigravity supports native JSON and terminal streaming results without confusing echoed schemas for output',()=>{
  const plan={clips:[{start:0,end:5}]};
  assert.deepEqual(agyResult(JSON.stringify({status:'SUCCESS',response:JSON.stringify(plan)})),plan);
  assert.deepEqual(agyResult(JSON.stringify({event:'init'})+'\n'+JSON.stringify({event:'result',result:{status:'SUCCESS',structured_output:plan}})),plan);
  assert.throws(()=>agyResult(JSON.stringify({status:'SUCCESS',response:'',json_schema:{type:'object'}})));
  assert.throws(()=>agyResult(JSON.stringify({status:'ERROR'})));
  assert.throws(()=>agyResult(JSON.stringify({status:'ERROR',error:{code:'RESOURCE_EXHAUSTED',message:'quota exhausted'}})),error=>error.code==='AI_QUOTA_PAUSED');
  assert.throws(()=>agyResult(JSON.stringify({event:'result',result:{status:'ERROR',error:{code:'RESOURCE_EXHAUSTED',message:'quota exhausted'}}})),error=>error.code==='AI_QUOTA_PAUSED');
});
test('native audio evidence requires a completed successful file read, not a model claim',()=>{
 const event={event:'step_update',step_update:{state:'DONE',step_type:'tool',tool_name:'read_file',tool_info:{parameters:{Path:'clip-1-sound-review.mp3'}}}};
 assert.deepEqual(mediaReadPaths(event,'.'),[resolve('clip-1-sound-review.mp3')]);
 assert.deepEqual(mediaReadPaths({event:'result',result:{response:'I listened to everything'}},'.'),[]);
 assert.deepEqual(mediaReadPaths({...event,step_update:{...event.step_update,state:'ACTIVE'}},'.'),[]);
 assert.deepEqual(mediaReadPaths({...event,step_update:{...event.step_update,tool_info:{...event.step_update.tool_info,error:{message:'Unable to read media'}}}},'.'),[]);
});
