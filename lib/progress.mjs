export const PROCESS_STAGES = ['import', 'captions', 'analysis', 'framing', 'audio', 'editing'];
export function updateStage(job, key, patch, clipId) {
  job.workflow ||= { stages: {}, clips: {} };
  const target = clipId ? (job.workflow.clips[clipId] ||= {}) : job.workflow.stages;
  const old = target[key] || {};
  target[key] = { ...old, ...patch, updatedAt: Date.now() };
  if (patch.state === 'running' && old.state !== 'running') target[key].startedAt = Date.now();
  if (patch.percent !== undefined && patch.percent !== null) target[key].percent = Math.max(0, Math.min(patch.state === 'done' ? 100 : 99.9, Number(patch.percent) || 0));
  if (patch.state === 'done' || patch.state === 'skipped') target[key].percent = 100;
  return target[key];
}
function clockSeconds(value) { return value.split(':').reduce((a, v) => a * 60 + Number(v), 0); }
export function mediaProgress(duration, callback) {
  let record = {};
  return line => {
    const pair = line.match(/^(out_time_us|out_time_ms|out_time|speed|total_size|frame|progress)=([^\s]*)$/);
    if (pair) {
      record[pair[1]] = pair[2];
      if (pair[1] !== 'progress') return;
      const seconds = Number(record.out_time_us ?? record.out_time_ms) / 1e6 || (record.out_time && !record.out_time.includes('N/A') ? clockSeconds(record.out_time) : 0);
      if (Number.isFinite(seconds) && seconds >= 0) callback({ percent: duration > 0 ? Math.min(99.9, seconds / duration * 100) : null, mediaSeconds: seconds, mediaTotal: duration, speed: record.speed && record.speed !== 'N/A' ? record.speed : undefined, bytes: Number(record.total_size) || undefined });
      record = {}; return;
    }
    // yt-dlp's external FFmpeg downloader forwards ordinary FFmpeg stats on stderr.
    const time = line.match(/\btime=(\d+:\d+:\d+(?:\.\d+)?)/);
    if (time) { const seconds = clockSeconds(time[1]); callback({ percent: duration > 0 ? Math.min(99.9, seconds / duration * 100) : null, mediaSeconds: seconds, mediaTotal: duration, speed: line.match(/\bspeed=\s*([^\s]+)/)?.[1] }); }
  };
}
export function downloadProgress(duration, callback) {
  const media = mediaProgress(duration, callback);
  return line => {
    const match = line.match(/CLIPMAX_DOWNLOAD:(\d+):([^:]+):([^:]+):([^:]+):([^\s]+)/);
    if (match) {
      const bytes = Number(match[1]), totalBytes = Number(match[2]) || Number(match[3]) || null;
      callback({ bytes, totalBytes, estimatedTotal: !Number(match[2]) && Boolean(Number(match[3])), percent: totalBytes ? Math.min(99.9, bytes / totalBytes * 100) : null, etaSeconds: Number(match[4]) || null, bytesPerSecond: Number(match[5]) || null });
    } else media(line);
  };
}
export function whisperProgress(callback) {
  return line => {
    const match = line.match(/progress\s*=\s*(\d+(?:\.\d+)?)%/);
    if (match) callback({ percent: Math.min(99.9, Number(match[1])) });
  };
}
