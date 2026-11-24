import test from 'node:test';import assert from 'node:assert/strict';
import{mkdtemp,writeFile,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';
import usage from '../lib/ai-usage.cjs';
import {run} from '../lib/core.mjs';
import {fileURLToPath} from 'node:url';
test('quota snapshots accept provider values, preserve zero and discard credential fields',()=>{
 const value=usage.normalizeUsage({email:'creator@example.com',access_token:'secret',quota:{'gemini-weekly':{remaining_fraction:0,reset_time:'2026-12-01T00:00:00Z'},unknown:{remaining_fraction:2}},context_window:{total_input_tokens:100,total_output_tokens:0},model:{id:'gemini'}});
 assert.equal(value.quota['gemini-weekly'].remaining_fraction,0);assert.equal(value.quota.unknown.remaining_fraction,null);assert.equal(value.context_window.total_output_tokens,0);assert.equal(value.access_token,undefined);
 assert.equal(usage.normalizeUsage({quota:{}}),null);
});
test('low-quota admission uses fresh provider balances for the requested model group only',()=>{
 const profile={accounts:[{email:'creator@example.com',stale:false,quota:{'gemini-weekly':{remaining_fraction:.12}}}]};
 assert.match(usage.quotaPause(profile,'gemini-3.8-flash'),/12%/);
 assert.equal(usage.quotaPause(profile,'claude-model'),null);
 profile.accounts[0].stale=true;assert.equal(usage.quotaPause(profile,'gemini-3.8-flash'),null);
 profile.accounts[0].stale=false;profile.accounts[0].quota['gemini-weekly'].remaining_fraction=null;assert.equal(usage.quotaPause(profile,'gemini-3.8-flash'),null);
});
test('official telemetry hook persists only quota/account fields, never credentials or transcript content',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clipmax-usage-hook-'));
 try{await run(process.execPath,[fileURLToPath(new URL('../lib/ai-usage.cjs',import.meta.url)),dir],{input:JSON.stringify({email:'creator@example.com',quota:{gemini:{remaining_fraction:.7}},access_token:'private-token',transcript_path:'private-conversation',model:{id:'gemini'}})});
 const profile=await usage.readUsageStore(dir);assert.equal(profile.accounts[0].email,'creator@example.com');assert.equal(profile.accounts[0].quota.gemini.remaining_fraction,.7);assert.ok(!JSON.stringify(profile).includes('private-token'));assert.ok(!JSON.stringify(profile).includes('private-conversation'));}finally{await rm(dir,{recursive:true,force:true});}
});
test('profile quota history marks stale data and never claims automatic account switching',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clipmax-usage-'));
 try{const value=usage.normalizeUsage({email:'creator@example.com',quota:{gemini:{remaining_fraction:.1}}},1000000);await writeFile(join(dir,'a'.repeat(64)+'.json'),JSON.stringify(value));const profile=await usage.readUsageStore(dir,2000000);assert.equal(profile.accounts[0].stale,true);assert.equal(profile.accounts[0].lowQuota,true);assert.equal(profile.automaticSwitchSupported,false);assert.equal(profile.lastObservedAccount,'creator@example.com');}finally{await rm(dir,{recursive:true,force:true});}
});
