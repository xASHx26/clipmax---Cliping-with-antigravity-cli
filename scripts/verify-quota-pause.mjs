// No provider requests: a fake CLI verifies checkpointed quota recovery.
import assert from 'node:assert/strict';import{mkdtemp,mkdir,writeFile,readFile,rm}from'node:fs/promises';
import{join,resolve}from'node:path';import{tmpdir}from'node:os';import{spawn}from'node:child_process';import{run}from'../lib/core.mjs';
if(process.platform!=='win32')throw Error('The quota checkpoint fixture uses the Windows compiler.');
const dir=await mkdtemp(join(tmpdir(),'clipmax-quota-check-')),source=join(dir,'quota.cs'),exe=join(dir,'quota.exe'),marker=join(dir,'calls.txt');
const payload=JSON.stringify({event:'result',result:{status:'ERROR',error:{code:'RESOURCE_EXHAUSTED',message:'Model quota exhausted'}}});
await writeFile(source,`using System;using System.IO;class Fixture{static void Main(){File.AppendAllText(Environment.GetEnvironmentVariable("CLIPMAX_TEST_MARKER"),"AI call"+Environment.NewLine);Console.WriteLine(${JSON.stringify(payload)});}}`);
await run('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:exe','/out:'+exe,source]);
const id='22222222-2222-4222-8222-222222222222',data=join(dir,'projects'),jobDir=join(data,id);await mkdir(jobDir,{recursive:true});
await writeFile(join(jobDir,'source.mp4'),'saved source fixture');await writeFile(join(jobDir,'cues.json'),JSON.stringify([{start:0,end:10,text:'A complete original statement.'}]));
await writeFile(join(jobDir,'job.json'),JSON.stringify({id,title:'Quota fixture',url:'https://youtu.be/quota-fixture',status:'ready',provider:'antigravity',model:'gemini-test',duration:30,count:1,maxSeconds:45,aspect:'9:16',createdAt:new Date().toISOString(),clips:[],autoUpload:{enabled:false}}));
const child=spawn(process.execPath,['server.mjs'],{cwd:resolve('.'),env:{...process.env,PORT:'4397',CLIPMAX_DATA_DIR:data,CLIPMAX_SETTINGS_DIR:dir,CLIPMAX_VAULT_KEY:'',AGY_PATH:exe,YTDLP_PATH:join(dir,'must-not-run.exe'),CLIPMAX_TEST_MARKER:marker},windowsHide:true,stdio:['ignore','pipe','pipe']});
const base='http://127.0.0.1:4397';let errors='';child.stderr.on('data',chunk=>errors+=chunk);
const call=async(path,body)=>{const r=await fetch(base+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
async function paused(){for(let i=0;i<150;i++){const job=(await call('/api/jobs')).find(j=>j.id===id);if(job.status==='paused')return job;if(job.status==='failed')throw Error(job.error);await new Promise(r=>setTimeout(r,30));}throw Error('Quota pause timeout '+errors);}
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout')),10000);child.stdout.on('data',chunk=>{if(chunk.toString().includes('Clipmax Studio:')){clearTimeout(timer);resolve();}});child.once('error',reject);});
 await call('/api/jobs/'+id+'/refine',{});const first=await paused();assert.equal(first.resumeStage,'analysis');assert.equal(first.error,undefined);assert.match(first.pauseReason,/quota/i);
 await call('/api/jobs/'+id+'/retry',{});await paused();assert.equal((await readFile(marker,'utf8')).trim().split(/\r?\n/).length,2);assert.equal(await readFile(join(jobDir,'source.mp4'),'utf8'),'saved source fixture');
 console.log('PASS: Provider quota error pauses instead of failing; resume reuses saved source/captions and retries only AI, with no downloader or uploads.');
}finally{child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));await rm(dir,{recursive:true,force:true});}
