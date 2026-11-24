import { taskSignal, throwIfCancelled } from './cancellation.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './core.mjs';
import { Worker } from 'node:worker_threads';

export function safeWebcam(box) {
  if (!box || !['x', 'y', 'w', 'h'].every(k => Number.isFinite(box[k]))) return null;
  if (box.x < 0 || box.y < 0 || box.w < .06 || box.h < .06 || box.w > .5 || box.h > .6 || box.x + box.w > 1.001 || box.y + box.h > 1.001) return null;
  return Object.fromEntries(['x', 'y', 'w', 'h'].map(k => [k, Math.round(box[k] * 10000) / 10000]));
}

export function headSafeBox(faces) {
  if(!faces?.length)return null;
  const left=Math.min(...faces.map(b=>b.x)),top=Math.min(...faces.map(b=>b.y)),right=Math.max(...faces.map(b=>b.x+b.w)),bottom=Math.max(...faces.map(b=>b.y+b.h));
  const w=right-left,h=bottom-top,x=Math.max(0,left-w*.75),y=Math.max(0,top-h*.9);
  return safeWebcam({x,y,w:Math.min(1-x,w*2.5),h:Math.min(1-y,h*2.8)});
}

// A persistent rectangular camera panel is safer than a tight face crop:
// it retains hats/hair and still works when a hand briefly covers the face.
export function cameraPanels(image) {
  const {width,height,data}=image,panels=[];
  const colored=(x,y)=>{const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2];return Math.max(r,g,b)>40&&Math.max(r,g,b)-Math.min(r,g,b)>24;};
  for(const side of ['left','right']){
    const span=Math.floor(width*.28),x0=side==='left'?0:width-span;let start=null;
    for(let y=0;y<=height;y++){
      let count=0;if(y<height)for(let x=x0;x<x0+span;x+=3)if(colored(x,y))count++;
      const active=count/(span/3)>.24;
      if(active&&start===null)start=y;
      if(!active&&start!==null){
        const h=y-start;
        if(h>=height*.10&&h<=height*.42){
          let first=null,last=null;
          for(let x=x0;x<x0+span;x++){
            let filled=0;for(let row=start;row<y;row+=3)if(colored(x,row))filled++;
            if(filled/(h/3)>.22){if(first===null)first=x;last=x;}
          }
          if(first!==null){const w=last-first+1,ratio=w/h;if(w>width*.10&&w<width*.29&&ratio>1.2&&ratio<2.25){const cameraHeight=Math.max(h,w/1.6),top=Math.max(0,y-cameraHeight-cameraHeight*.1);const box=safeWebcam({x:first/width,y:top/height,w:w/width,h:Math.min(height-top,cameraHeight*1.2)/height});if(box)panels.push(box);}}
        }
        start=null;
      }
    }
  }
  return panels;
}

let modelPromise;
async function localDetector() {
  if (!modelPromise) modelPromise = (async()=>{
    const tf = await import('@tensorflow/tfjs-core'); await import('@tensorflow/tfjs-backend-cpu');
    await tf.setBackend('cpu'); await tf.ready();
    // Load the TFJS runtime directly; the root export also requires an unused
    // browser/WASM MediaPipe peer that is not part of the desktop runtime.
    const face = await import('@tensorflow-models/face-detection/dist/tfjs/detector.js');
    const dir = process.env.FACE_MODEL_DIR || fileURLToPath(new URL('../bin/face/',import.meta.url));
    const model = JSON.parse(await readFile(join(dir,'model.json'),'utf8'));
    const bytes = Buffer.concat(await Promise.all(model.weightsManifest.flatMap(group=>group.paths).map(path=>readFile(join(dir,path)))));
    const handler = tf.io.fromMemory({modelTopology:model.modelTopology,weightSpecs:model.weightsManifest.flatMap(group=>group.weights),weightData:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
    const detector = await face.load({runtime:'tfjs',modelType:'full',maxFaces:8,detectorModelUrl:handler});
    return {tf,detector};
  })().catch(error=>{modelPromise=null;throw error});
  return modelPromise;
}

export async function detectFraming({job,dir,source,ffmpeg,onProgress=()=>{}}) {
  throwIfCancelled();
  const signal = taskSignal();
  return await new Promise((resolve,reject)=>{
    let finished=false;
    const worker=new Worker(new URL('./framing-worker.mjs',import.meta.url),{workerData:{job:{clips:job.clips.map(({id,start,end})=>({id,start,end}))},dir,source,ffmpeg},execArgv:[]});
    const done=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);signal?.aborted?reject(signal.reason):error?reject(error):resolve(result);};
    const timer=setTimeout(()=>{worker.terminate();done(new Error('Head framing timed out; preserve the full source.'));},Math.max(180000,job.clips.length*90000));
    const abort=()=>worker.postMessage('cancel');
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    worker.on('message',message=>{if(message.progress)onProgress(message.progress);else if(message.error)done(new Error(message.error));else if(message.result)done(null,message.result);});
    worker.once('error',error=>done(error));worker.once('exit',code=>{if(!finished)done(new Error(`Head framing stopped (${code}); preserve the full source.`));});
  });
}
export async function detectFramingLocal({job,dir,source,ffmpeg,onProgress=()=>{}}) {
  const {tf,detector} = await localDetector();
  const jpeg = (await import('jpeg-js')).default;
  const layouts = {}, audit=[]; let processed = 0;
  for(const clip of job.clips) {
    throwIfCancelled();
    const frames=[],panels=[];
    const fractions=[.01,.2,.4,.6,.8,.99];
    for(const [index,fraction] of fractions.entries()) {
      const file = 'framing-'+clip.id+'-'+index+'.jpg';
      await run(ffmpeg,['-y','-ss',String(clip.start+(clip.end-clip.start)*fraction),'-i',source,'-frames:v','1','-vf','scale=960:-2',file],{cwd:dir});
      const image = jpeg.decode(await readFile(join(dir,file)),{useTArray:true}), faces=[];
      const width = image.width,height = image.height,w=Math.floor(width/2),h=Math.floor(height/2);
      if(width/height>1.3) for(const [x,y] of [[0,0],[w,0],[0,h],[w,h]]) {
        const tensor=tf.tidy(()=>tf.slice(tf.tensor3d(image.data,[height,width,4],'int32'),[y,x,0],[h,w,3]));
        try {for(const face of await detector.estimateFaces(tensor,{flipHorizontal:false})) {
          const b=face.box,box={x:(b.xMin+x)/width,y:(b.yMin+y)/height,w:b.width/width,h:b.height/height};
          const center=box.x+box.w/2;
          if((center<.25||center>.75)&&box.w>.02&&box.w<.20&&box.h>.03&&box.h<.35)faces.push(box);
        }} finally {tensor.dispose();}
      }
      frames.push(faces);panels.push(cameraPanels(image));audit.push({clip:clip.id,index,faces,panels:panels.at(-1)});processed++;
      onProgress({percent:processed/(job.clips.length*fractions.length)*100,message:'Checking head framing · '+processed+'/'+(job.clips.length*fractions.length)+' frames'});
    }
    let webcam=null;
    for(const panel of panels[0]){
      const stable=panels.every(list=>list.some(b=>Math.abs(b.x-panel.x)<.018&&Math.abs(b.y-panel.y)<.018&&Math.abs(b.w-panel.w)<.025&&Math.abs(b.h-panel.h)<.025));
      const containsFace=frames.flat().some(face=>face.x+face.w/2>panel.x&&face.x+face.w/2<panel.x+panel.w&&face.y>panel.y&&face.y+face.h<panel.y+panel.h+.015);
      if(stable&&containsFace){webcam=panel;break;}
    }
    for(const first of frames[0]) {
      if(webcam)break;
      const matches=frames.slice(1).map(list=>list.find(box=>Math.abs((box.x+box.w/2)-(first.x+first.w/2))<.07&&Math.abs((box.y+box.h/2)-(first.y+first.h/2))<.09));
      if(matches.some(box=>!box))continue;
      webcam=headSafeBox([first,...matches]);
      if(webcam)break;
    }
    layouts[clip.id]={mode:webcam?'streamer':'preserve',webcam,reason:webcam?'Head position checked across six frames with added headroom; camera image fits without an extra crop.':'No stable webcam confirmed across the clip; the full source is preserved.'};
  }
  await writeFile(join(dir,'framing-detections.json'),JSON.stringify(audit));
  return layouts;
}
