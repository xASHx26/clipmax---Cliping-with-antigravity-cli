import { join } from 'node:path';
import aiUsage from './ai-usage.cjs';
import { run, parseJson } from './core.mjs';
function quotaError(message='Antigravity reported an exhausted model quota. Wait for quota to reset or change accounts through Antigravity, then resume.') { const error=new Error(message);error.code='AI_QUOTA_PAUSED';return error; }
const quotaFailure = message => /(?:quota|credits?).{0,60}(?:exhausted|depleted|limit|insufficient)|resource_exhausted|rate.?limit/i.test(message);
export function agyResult(output) {
  let envelope;
  try { envelope=JSON.parse(output); }
  catch { const events=output.split(/\r?\n/).filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return null}}); envelope=events.findLast(event=>event?.event==='result')?.result; }
  if(envelope?.event==='result')envelope=envelope.result;
  if (!envelope) throw new Error('Antigravity returned no completed result.');
  if (envelope.status==='ERROR' || envelope.is_error) {
    if(quotaFailure(JSON.stringify(envelope)))throw quotaError();
    throw new Error('Antigravity could not complete the request. Check the model, sign-in and quota.');
  }
  if (envelope.structured_output) return envelope.structured_output;
  if (envelope.clips) return envelope;
  for(const value of [envelope.response,envelope.result]) { if(typeof value==='string'&&value.trim())return parseJson(value); if(value?.clips)return value; }
  throw new Error('Antigravity returned no structured clip plan.');
}
export async function askAgy({prompt,schema,model,dir,onProgress=()=>{}}) {
  if(process.env.CLIPMAX_SETTINGS_DIR){const profile=await aiUsage.readUsageStore(join(process.env.CLIPMAX_SETTINGS_DIR,'ai-usage')),pause=aiUsage.quotaPause(profile,model);if(pause)throw quotaError(pause);}
  const args=['--mode','plan','--sandbox','--input-format','stream-json','--output-format','stream-json','--print-timeout','240s','--json-schema',JSON.stringify(schema)];
  if(model)args.push('--model',model);
  if(process.env.CLIPMAX_SETTINGS_DIR){const telemetry=aiUsage.captureSettings(join(process.env.CLIPMAX_SETTINGS_DIR,'ai-usage'));if(telemetry)args.push('--settings',JSON.stringify(telemetry));}
  let lastSignal=0;
  let output;
  try {output=await run(process.env.AGY_PATH || 'agy',args,{cwd:dir,timeout:270000,input:JSON.stringify({event:'user',message:{content:prompt}})+'\n',onLine:line=>{try {const event=JSON.parse(line);if(event.event==='step_update'&&Date.now()-lastSignal>1000){lastSignal=Date.now();onProgress({percent:null,message:'Antigravity is evaluating complete stories'});}}catch{}}});}
  catch(error){if(error.code!=='PROJECT_CANCELLED'&&quotaFailure(error.message))throw quotaError();throw error;}
  return agyResult(output);
}
