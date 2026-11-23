import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const dir=resolve('bin/face');await mkdir(dir,{recursive:true});
const response=await fetch('https://tfhub.dev/mediapipe/tfjs-model/face_detection/full/1/model.json?tfjs-format=file');
if(!response.ok) throw new Error('Face model download failed.');
const model=await response.json();
for(const group of model.weightsManifest) for(let i=0;i<group.paths.length;i++) {
  const remote=new URL(group.paths[i],'https://tfhub.dev/mediapipe/tfjs-model/face_detection/full/1/'), name=`weights-${i}.bin`;
  remote.searchParams.set('tfjs-format','file');
  const weights=await fetch(remote);if(!weights.ok)throw new Error('Face model weights download failed.');
  await writeFile(join(dir,name),new Uint8Array(await weights.arrayBuffer()));group.paths[i]=name;
}
await writeFile(join(dir,'model.json'),JSON.stringify(model));
const license=await fetch('https://raw.githubusercontent.com/tensorflow/tfjs-models/master/LICENSE');
if(!license.ok)throw new Error('Model license download failed.');
await writeFile(join(dir,'LICENSE.txt'),await license.text());
console.log('Local MediaPipe face model and license ready.');
