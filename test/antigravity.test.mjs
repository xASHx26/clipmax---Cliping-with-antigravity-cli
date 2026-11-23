import test from 'node:test';import assert from 'node:assert/strict';import {agyResult} from '../lib/antigravity.mjs';
test('Antigravity supports native JSON and terminal streaming results without confusing echoed schemas for output',()=>{
  const plan={clips:[{start:0,end:5}]};
  assert.deepEqual(agyResult(JSON.stringify({status:'SUCCESS',response:JSON.stringify(plan)})),plan);
  assert.deepEqual(agyResult(JSON.stringify({event:'init'})+'\n'+JSON.stringify({event:'result',result:{status:'SUCCESS',structured_output:plan}})),plan);
  assert.throws(()=>agyResult(JSON.stringify({status:'SUCCESS',response:'',json_schema:{type:'object'}})));
  assert.throws(()=>agyResult(JSON.stringify({status:'ERROR'})));
});
