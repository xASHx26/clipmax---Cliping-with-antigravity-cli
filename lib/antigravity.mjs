import { run, parseJson } from './core.mjs';
export function agyResult(output) {
  let envelope;
  try { envelope=JSON.parse(output); }
  catch { const events=output.split(/\r?\n/).filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return null}}); envelope=events.findLast(event=>event?.event==='result')?.result; }
  if (!envelope) throw new Error('Antigravity returned no completed result.');
  if (envelope.status==='ERROR' || envelope.is_error) throw new Error('Antigravity could not complete the request. Check the model, sign-in and quota.');
  if (envelope.structured_output) return envelope.structured_output;
  if (envelope.clips) return envelope;
  for(const value of [envelope.response,envelope.result]) { if(typeof value==='string'&&value.trim())return parseJson(value); if(value?.clips)return value; }
  throw new Error('Antigravity returned no structured clip plan.');
}
export async function askAgy({prompt,schema,model,dir,onProgress=()=>{}}) {
  const args=['--mode','plan','--sandbox','--input-format','stream-json','--output-format','stream-json','--print-timeout','240s','--json-schema',JSON.stringify(schema)];
  if(model)args.push('--model',model);
  let lastSignal=0;
  const output=await run(process.env.AGY_PATH || 'agy',args,{cwd:dir,timeout:270000,input:JSON.stringify({event:'user',message:{content:prompt}})+'\n',onLine:line=>{try {const event=JSON.parse(line);if(event.event==='step_update'&&Date.now()-lastSignal>1000){lastSignal=Date.now();onProgress({percent:null,message:'Antigravity is evaluating complete stories'});}}catch{}}});
  return agyResult(output);
}
