import https from 'node:https';
import http from 'node:http';

// Progress comes from completed request writes, never from a timer. The response
// still decides whether the platform accepted the file.
export function uploadBytes(url, { body, headers, method = 'PUT', onProgress, timeout = 180000 }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url), transport = target.protocol === 'https:' ? https : http;
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && target.hostname === '127.0.0.1')) return reject(new Error('Invalid upload destination.'));
    let bytes = 0, stopped = false;
    const request = transport.request(target, { method, headers: { ...headers, 'Content-Length': String(body.length) } }, response => {
      stopped = true; const parts = [];
      response.on('data', part => parts.push(part));
      response.on('error', reject);
      response.on('end', () => { clearTimeout(timer); resolve(new Response([204, 205, 304].includes(response.statusCode) ? null : Buffer.concat(parts), { status: response.statusCode, headers: response.headers })); });
    });
    const timer = setTimeout(() => request.destroy(new Error('Platform upload timed out.')), timeout);
    request.on('error', error => { stopped = true; clearTimeout(timer); reject(error); });
    const next = () => {
      if (stopped || request.destroyed) return;
      if (bytes >= body.length) { request.end(); return; }
      const chunk = body.subarray(bytes, bytes + 256 * 1024);
      request.write(chunk, error => {
        if (error) { request.destroy(error); return; }
        bytes += chunk.length;
        onProgress?.({ bytes, totalBytes: body.length, percent: Math.min(99.9, bytes / body.length * 100) }); next();
      });
    };
    onProgress?.({ bytes: 0, totalBytes: body.length, percent: 0 }); next();
  });
}
