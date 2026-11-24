const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const label = (value,max=120) => typeof value === 'string' ? value.replace(/[\x00-\x1f<>]/g,'').slice(0,max) : '';
function normalizeUsage(input, observedAt = Date.now()) {
  if(!input || typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length>254 || !Number.isFinite(observedAt))return null;
  const quota={};
  for(const [key,value] of Object.entries(input.quota || {}).slice(0,32)) {
    if(!value || typeof value!=='object')continue;
    const reset=Date.parse(value.reset_time);
    quota[label(key)]={remaining_fraction:finite(value.remaining_fraction)&&value.remaining_fraction<=1?value.remaining_fraction:null,remaining_amount:finite(value.remaining_amount)?value.remaining_amount:null,reset_time:Number.isFinite(reset)?new Date(reset).toISOString():null,disabled:value.disabled===true};
  }
  const context=input.context_window || {};
  return {email:input.email,plan_tier:label(input.plan_tier,60),model:{id:label(input.model?.id),display_name:label(input.model?.display_name)},quota,
    context_window:{total_input_tokens:finite(context.total_input_tokens)?context.total_input_tokens:null,total_output_tokens:finite(context.total_output_tokens)?context.total_output_tokens:null},observedAt:new Date(observedAt).toISOString(),source:'Antigravity statusLine'};
}
function captureSettings(storeDir) {
  const args=[process.execPath,__filename,storeDir];
  if(process.platform==='win32') {
    if(args.some(value=>/["\r\n%!]/.test(value)))return null;
    return {statusLine:{type:'command',command:'set ELECTRON_RUN_AS_NODE=1&&'+args.map(value=>'"'+value+'"').join(' ')}};
  }
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  return {statusLine:{type:'command',command:'ELECTRON_RUN_AS_NODE=1 '+args.map(quote).join(' ')}};
}
async function readUsageStore(dir, now=Date.now()) {
  let files;try{files=await fs.promises.readdir(dir);}catch(error){if(error.code==='ENOENT')return {accounts:[],lastObservedAccount:null,automaticSwitchSupported:false};throw error;}
  const accounts=[];
  for(const file of files.filter(file=>/^[a-f0-9]{64}\.json$/.test(file)).slice(0,100)) {
    try{const stat=await fs.promises.stat(path.join(dir,file));if(stat.size>65536)continue;const raw=JSON.parse(await fs.promises.readFile(path.join(dir,file),'utf8')),value=normalizeUsage(raw,Date.parse(raw.observedAt));if(!value)continue;
      const expired=Object.values(value.quota).some(bucket=>bucket.reset_time&&Date.parse(bucket.reset_time)<=now);
      accounts.push({...value,stale:expired||now-Date.parse(value.observedAt)>600000,lowQuota:Object.values(value.quota).some(bucket=>bucket.remaining_fraction!==null&&bucket.remaining_fraction<=.15)});
    }catch{}
  }
  accounts.sort((a,b)=>b.observedAt.localeCompare(a.observedAt));
  return {accounts,lastObservedAccount:accounts[0]?.email||null,automaticSwitchSupported:false};
}
function quotaPause(profile, model='') {
  if(!/gemini/i.test(model))return null;
  const account=profile.accounts?.[0];if(!account||account.stale)return null;
  const low=Object.entries(account.quota).find(([key,bucket])=>/gemini/i.test(key)&&bucket.remaining_fraction!==null&&bucket.remaining_fraction<=.15);
  if(!low)return null;
  return 'AI paused: '+account.email+' last reported '+Math.round(low[1].remaining_fraction*100)+'% remaining in '+low[0]+'. Refresh quota after a reset or an official account change, then resume.';
}
module.exports={normalizeUsage,captureSettings,readUsageStore,quotaPause};
if(require.main===module) {
  let raw='';process.stdin.setEncoding('utf8');
  process.stdin.on('data',chunk=>{raw+=chunk;if(raw.length>1048576)process.exit(1);});
  process.stdin.on('end',()=>{try{
    const value=normalizeUsage(JSON.parse(raw));if(!value)return;
    const dir=process.argv[2];if(!dir||!path.isAbsolute(dir))throw Error('Invalid usage directory');
    fs.mkdirSync(dir,{recursive:true});const id=crypto.createHash('sha256').update(value.email.toLowerCase()).digest('hex'),file=path.join(dir,id+'.json'),temp=file+'.'+process.pid+'.tmp';
    fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});fs.renameSync(temp,file);
    process.stdout.write('Clipmax · quota synced');
  }catch{process.exitCode=1;}});
}
