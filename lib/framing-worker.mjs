import { parentPort, workerData } from 'node:worker_threads';
import { detectFramingLocal } from './framing.mjs';
try {parentPort.postMessage({result:await detectFramingLocal({...workerData,onProgress:progress=>parentPort.postMessage({progress})})});}
catch(error){parentPort.postMessage({error:error.message});}
finally{parentPort.close();}
