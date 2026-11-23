const RATE=48000;
function wav(samples,{peak=.7,highpass=180}={}) {
  const cleaned=new Float64Array(samples.length);let previous=0,hp=0,lp=0,maximum=.001;
  const a=Math.exp(-2*Math.PI*highpass/RATE),b=Math.exp(-2*Math.PI*10000/RATE);
  for(let i=0;i<samples.length;i++){
    const fade=Math.min(1,i/(RATE*.002),(samples.length-1-i)/(RATE*.008));
    const x=samples[i]*Math.max(0,fade);hp=a*(hp+x-previous);previous=x;lp=(1-b)*hp+b*lp;cleaned[i]=lp*Math.min(1,(samples.length-1-i)/(RATE*.002));maximum=Math.max(maximum,Math.abs(cleaned[i]));
  }
  const bytes=Buffer.alloc(44+samples.length*2);bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(RATE,24);bytes.writeUInt32LE(RATE*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples.length*2,40);
  for(let i=0;i<cleaned.length;i++)bytes.writeInt16LE(Math.round(cleaned[i]/maximum*peak*32767),44+i*2);
  return bytes;
}
export const EFFECT_LENGTHS={notification:.30,pop:.10,tick:.04,chime:.32,sting:.18,record_stop:.16,whoosh:.12,impact:.11};
export function effectWave(name='notification') {
  if(name==='fahh')name='impact';
  const duration=EFFECT_LENGTHS[name];if(!duration)throw new Error('Choose a supported opening sound.');
  const samples=new Float64Array(Math.floor(RATE*duration));let seed=719,previous=0;
  const note=(t,frequency,decay)=>t<0?0:Math.sin(2*Math.PI*frequency*t)*Math.min(1,t/.002)*Math.exp(-t/decay);
  for(let i=0;i<samples.length;i++){
    const t=i/RATE;
    if(name==='notification')samples[i]=note(t,740,.045)+note(t-.115,988,.055)*.85;
    if(name==='pop')samples[i]=Math.sin(2*Math.PI*(1200*t-3500*t*t))*Math.exp(-t/.022);
    if(name==='tick')samples[i]=(Math.sin(2*Math.PI*1850*t)+.18*Math.sin(2*Math.PI*4900*t))*Math.exp(-t/.008);
    if(name==='chime')samples[i]=note(t,1046.5,.085)+.25*note(t,1569.8,.07);
    if(name==='sting')samples[i]=(note(t,659,.055)+note(t,784,.05)+note(t,932,.045))*.4;
    if(name==='record_stop')samples[i]=Math.sin(2*Math.PI*(800*t-2100*t*t))*Math.exp(-t/.04);
    if(name==='impact')samples[i]=(Math.sin(2*Math.PI*330*t)+.3*Math.sin(2*Math.PI*990*t))*Math.exp(-t/.018);
    if(name==='whoosh'){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=seed/2147483648-1;samples[i]=(noise-previous)*Math.sin(Math.PI*t/duration)**2;previous=noise;}
  }
  return wav(samples,{highpass:name==='whoosh'?1800:200});
}
export function backgroundWave(name='ambient') {
  const scores={ambient:{notes:[261.63,329.63,392,329.63],beat:2,decay:1.8},melancholy:{notes:[220,261.63,329.63,246.94],beat:2,decay:1.5},playful:{notes:[523.25,659.25,783.99,659.25,587.33,659.25,523.25,783.99],beat:.5,decay:.16},pulse:{notes:[261.63,392,440,329.63],beat:.5,decay:.23},tension:{notes:[261.63,277.18,261.63,311.13],beat:1,decay:.5}};
  const score=scores[name];if(!score)throw new Error('Choose a supported background mood.');
  const samples=new Float64Array(RATE*8);
  for(let i=0;i<samples.length;i++){
    const t=i/RATE;let value=0;
    for(let start=0,index=0;start<8;start+=score.beat,index++){
      const u=t-start;if(u<0||u>score.decay*5)continue;
      const f=score.notes[index%score.notes.length],phase=2*Math.PI*f*u;
      value+=(Math.sin(phase)+.20*Math.sin(phase*2)+.06*Math.sin(phase*3))*Math.min(1,u/.02)*Math.exp(-u/score.decay);
    }
    samples[i]=value;
  }
  return wav(samples,{peak:.55,highpass:150});
}
