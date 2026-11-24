import { parentPort, workerData } from 'node:worker_threads';
import { detectFramingLocal } from './framing.mjs';
import { withCancellation, cancellationError } from './cancellation.mjs';
const controller = new AbortController();
parentPort.on('message', message => { if (message === 'cancel') controller.abort(cancellationError()); });
try {parentPort.postMessage({result:await withCancellation(controller.signal,()=>detectFramingLocal({...workerData,onProgress:progress=>parentPort.postMessage({progress})}))});}
catch(error){parentPort.postMessage({error:error.message});}
finally{parentPort.close();}
