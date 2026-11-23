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
export const EFFECT_LENGTHS={notification:.30,pop:.10,tick:.04,chime:.32,sting:.18,record_stop:.16,whoosh:.12,impact:.11,bass_drop:.28,rimshot:.16,rewind:.24,camera:.12,sparkle:.30,error:.26,slide:.30,energy:.28,glass:.30};
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
    if(name==='bass_drop')samples[i]=(Math.sin(2*Math.PI*(55*t+180*.035*(1-Math.exp(-t/.035))))+.12*Math.sin(2*Math.PI*440*t)*Math.exp(-t/.015))*Math.exp(-t/.065);
    if(name==='rimshot'){seed=(Math.imul(seed,1664525)+1013904223)>>>0;samples[i]=(.7*Math.sin(2*Math.PI*820*t)+.25*(seed/2147483648-1))*Math.exp(-t/.025);}
    if(name==='rewind')samples[i]=(Math.sin(2*Math.PI*(500*t+1800*t*t))+Math.sin(2*Math.PI*(760*t+2500*t*t))*.25)*Math.exp(-t/.06);
    if(name==='camera'){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const n=seed/2147483648-1;samples[i]=(n-previous)*(Math.exp(-t/.009)+.5*Math.exp(-Math.abs(t-.055)/.006));previous=n;}
    if(name==='sparkle')samples[i]=note(t,1174,.05)+.65*note(t-.065,1568,.06)+.45*note(t-.13,2093,.05);
    if(name==='error')samples[i]=(Math.sin(2*Math.PI*(t<.11?330:220)*t)+.16*Math.sin(2*Math.PI*660*t))*Math.exp(-t/.10);
    if(name==='slide')samples[i]=(Math.sin(2*Math.PI*(650*t+1900*t*t))+.2*Math.sin(2*Math.PI*1300*t))*Math.sin(Math.PI*t/duration)**2;
    if(name==='energy')samples[i]=(Math.sin(2*Math.PI*(2100*t-2900*t*t))+.25*Math.sin(2*Math.PI*(3100*t-4200*t*t)))*Math.exp(-t/.06);
    if(name==='glass')samples[i]=[1931,2743,3989,5741].reduce((v,f,j)=>v+Math.sin(2*Math.PI*f*t)*Math.exp(-t/(.035+j*.015))/(j+1),0);
    if(name==='whoosh'){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=seed/2147483648-1;samples[i]=(noise-previous)*Math.sin(Math.PI*t/duration)**2;previous=noise;}
  }
  return wav(samples,{highpass:name==='whoosh'?1800:name==='bass_drop'?35:200});
}
export const BACKGROUNDS=['ambient','melancholy','playful','pulse','tension','lofi','bounce','mischief','cinematic','suspense','acoustic','hoedown','epic'];
export function backgroundWave(name='ambient',variation=0) {
  if(['lofi','bounce','mischief','cinematic','suspense','acoustic','hoedown','epic'].includes(name))return arrangedBed(name,variation);
  const scores={ambient:{notes:[261.63,329.63,392,329.63],beat:2,decay:1.8},melancholy:{notes:[220,261.63,329.63,246.94],beat:2,decay:1.5},playful:{notes:[523.25,659.25,783.99,659.25,587.33,659.25,523.25,783.99],beat:.5,decay:.16},pulse:{notes:[261.63,392,440,329.63],beat:.5,decay:.23},tension:{notes:[261.63,277.18,261.63,311.13],beat:1,decay:.5}};
  const score=scores[name];if(!score)throw new Error('Choose a supported background mood.');
  const samples=new Float64Array(RATE*8);
  for(let i=0;i<samples.length;i++){
    const t=i/RATE;let value=0;
    for(let start=0,index=0;start<8;start+=score.beat,index++){
      const u=t-start;if(u<0||u>score.decay*5)continue;
      const shift=[1,Math.pow(2,2/12),Math.pow(2,-3/12)][Math.abs(variation)%3];
      const f=score.notes[(index+Math.abs(variation)%score.notes.length)%score.notes.length]*shift,phase=2*Math.PI*f*u;
      value+=(Math.sin(phase)+.20*Math.sin(phase*2)+.06*Math.sin(phase*3))*Math.min(1,u/.02)*Math.exp(-u/score.decay);
    }
    samples[i]=value;
  }
  return wav(samples,{peak:.55,highpass:150});
}

// Original short-form arrangements. No sampled creator tracks or copied melodies.
function arrangedBed(name,variation) {
  let seed=(Number(variation)>>>0)||719;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
  const samples=new Float64Array(RATE*8), transpose=[-3,0,2,5][seed%4];
  const hz=midi=>440*Math.pow(2,(midi+transpose-69)/12);
  const note=(start,length,midi,level,timbre='keys')=>{
    const f=hz(midi),first=Math.round(start*RATE),last=Math.min(samples.length,first+Math.round(length*RATE));
    const attack=timbre==='pad'?.12:timbre==='bow'?.07:.008,decay=timbre==='pluck'?.13:timbre==='bass'?.32:timbre==='pad'?1.8:.7;
    for(let i=first;i<last;i++){const t=(i-first)/RATE,phase=2*Math.PI*f*t,tail=Math.min(1,(last-i)/(RATE*.06));
      let tone=Math.sin(phase)+(timbre==='pad'?.10:timbre==='bass'?.16:.26)*Math.sin(phase*2)+.08*Math.sin(phase*3);
      if(timbre==='guitar')tone=Math.sin(phase)+.45*Math.sin(phase*2)*Math.exp(-t*4)+.24*Math.sin(phase*3)*Math.exp(-t*6)+.12*Math.sin(phase*5)*Math.exp(-t*8);
      if(timbre==='bow')tone=Math.sin(phase+Math.sin(2*Math.PI*5*t)*.03)+.38*Math.sin(phase*2)+.23*Math.sin(phase*3)+.12*Math.sin(phase*4);
      samples[i]+=tone*Math.min(1,t/attack)*Math.exp(-t/decay)*level*tail;
    }
  };
  const drum=(start,type,level)=>{
    const length=type==='hat'?.035:.14,first=Math.round(start*RATE),last=Math.min(samples.length,first+Math.round(length*RATE));let prev=0;
    for(let i=first;i<last;i++){const t=(i-first)/RATE,n=random()*2-1;let value;
      if(type==='kick')value=Math.sin(2*Math.PI*(53*t+90*.018*(1-Math.exp(-t/.018))))*Math.exp(-t/.045);
      else value=(n-prev)*Math.exp(-t/(type==='hat'?.009:.028))+(type==='snare'?.2*Math.sin(2*Math.PI*190*t)*Math.exp(-t/.04):0);
      prev=n;samples[i]+=value*level;
    }
  };
  const roots=[45,41,48,43],offset=seed%4;
  for(let bar=0;bar<4;bar++){
    const root=roots[(bar+offset)%4],base=bar*2;
    if(name==='acoustic'){
      for(let step=0;step<8;step++)note(base+step*.25,.85,root+[12,19,24,15,19,24,22,19][(step+seed%2)%8],.34,'guitar');
      note(base,.6,root,.22,'bass');note(base+1,.6,root+7,.18,'bass');
    } else if(name==='hoedown'){
      for(let step=0;step<8;step++)note(base+step*.25,.23,root+24+[0,3,7,10,7,3,5,7][(step+seed%4)%8],.24,'bow');
      for(let beat=0;beat<4;beat++){note(base+beat*.5,.2,root+(beat%2?7:0),.28,'guitar');if(beat%2)drum(base+beat*.5,'snare',.055);}
    } else if(name==='epic'){
      for(const interval of [12,15,19,24])note(base,1.9,root+interval,.22,'bow');
      note(base,.9,root,.4,'bass');drum(base,'kick',.35);if(bar%2)drum(base+1.5,'snare',.12);
      note(base+1,.8,root+31,.16,'pad');
    } else if(name==='cinematic'){
      for(const interval of [12,15,19])note(base+random()*.04,2,root+interval,.28,'pad');
      note(base+.12,1.6,root+24,.36);if(bar%2)note(base+1.3,.6,root+27,.22);
    } else if(name==='suspense'){
      note(base,2,root,.3,'pad');for(let beat=0;beat<4;beat++)note(base+beat*.5,.36,root+24+(beat%2),.15,'pluck');
      if(bar%2)drum(base+1.5,'kick',.12);
    } else if(name==='mischief'){
      for(let beat=0;beat<4;beat++)note(base+beat*.5+(beat%2?.05:0),.3,root+12+[0,7,3,10][(beat+seed%4)%4],.38,'pluck');
      note(base,.45,root,.35,'bass');note(base+1,.4,root+7,.25,'bass');
    } else {
      for(const interval of [12,15,19,22])note(base+.02,1.8,root+interval,.19);
      note(base,.65,root,.4,'bass');note(base+1.25,.5,root+7,.28,'bass');
      for(let beat=0;beat<4;beat++){if(beat%2)drum(base+beat*.5+(name==='lofi'?.025:0),'snare',.12);else drum(base+beat*.5,'kick',.38);}
      for(let tick=0;tick<8;tick++)if(random()>.12)drum(base+tick*.25+(tick%2?.025:0),'hat',.045);
      if(name==='bounce')for(let beat=0;beat<4;beat++)note(base+beat*.5+.125,.18,root+24+[0,3,7,10][(beat+seed%4)%4],.23,'pluck');
    }
  }
  return wav(samples,{peak:.55,highpass:35});
}
