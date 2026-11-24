(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const names = { youtube: 'YouTube', tiktok: 'TikTok', facebook: 'Facebook', instagram: 'Instagram', linkedin:'LinkedIn',x:'X',threads:'Threads',bluesky:'Bluesky' };
  const completed = stage => ['done', 'skipped'].includes(stage?.state);
  const seconds = value => `${Math.floor(Math.max(0, value) / 60)}:${String(Math.floor(Math.max(0, value) % 60)).padStart(2, '0')}`;
  const bytes = value => value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;
  function meter(stage, title) {
    const state = stage?.state || 'pending', determinate = Number.isFinite(stage?.percent);
    const value = completed(stage) ? 100 : determinate ? Math.max(0, Math.min(99.9, stage.percent)) : 0;
    const running = state === 'running';
    const label = completed(stage) ? 'Complete' : running ? determinate ? `${stage.estimatedTotal ? '~' : ''}${Math.floor(value)}%` : 'Working…' : state === 'failed' ? 'Stopped' : state === 'waiting' ? 'Your action needed' : 'Waiting';
    const metrics = [];
    if (stage?.mediaTotal && Number.isFinite(stage.mediaSeconds)) metrics.push(`${seconds(stage.mediaSeconds)} / ${seconds(stage.mediaTotal)}`);
    else if (Number.isFinite(stage?.bytes)) metrics.push(`${bytes(stage.bytes)}${stage.totalBytes ? ` / ${stage.estimatedTotal ? '~' : ''}${bytes(stage.totalBytes)}` : ' processed'}`);
    if (stage?.speed) metrics.push(stage.speed);
    if (stage?.etaSeconds > 0) metrics.push(`${seconds(stage.etaSeconds)} ETA`);
    if (running && stage.updatedAt) { const age = Math.floor((Date.now() - stage.updatedAt) / 1000); if (age > 4) metrics.push(`Last signal ${age}s ago`); }
    return `<div class="wf-meter"><progress max="100" ${running && !determinate ? '' : `value="${value}"`} aria-label="${esc(title)} progress"></progress><span>${esc(label)}</span></div>${metrics.length ? `<small class="wf-metrics">${esc(metrics.join(' · '))}</small>` : ''}`;
  }
  function node(title, icon, stage = {}, extra = '') {
    return `<div class="wf-node ${esc(stage.state || 'pending')}"><div class="wf-node-title"><span class="wf-icon">${icon}</span><strong>${esc(title)}</strong></div>${stage.message ? `<p>${esc(stage.message)}</p>` : '<p>Not started</p>'}${meter(stage, title)}${extra}</div>`;
  }
  const child = (html, multiple = false) => `<ul class="wf-children${multiple ? ' branches' : ''}">${html}</ul>`;
  const item = (html, children = '') => `<li>${html}${children}</li>`;
  function uploadBranches(job, clip) {
    const stages = job.workflow?.clips?.[clip.id] || {};
    const platforms = [...new Set([...Object.keys(stages).filter(k => k.startsWith('upload:')).map(k => k.slice(7)), ...Object.keys(clip.publications || {}), ...Object.keys(clip.browserHandoffs || {})])];
    if (!platforms.length) return child(item(node('Upload', '◎', { state: 'pending', message: clip.url ? 'Choose accounts to publish' : 'Available after export' })));
    return child(platforms.map(platform => {
      const result = clip.publications?.[platform], handoff = clip.browserHandoffs?.[platform];
      const stage = stages[`upload:${platform}`] || (handoff ? { state: 'waiting', message: 'Finish posting in browser' } : ['uploaded', 'processing', 'published'].includes(result?.status) ? { state: 'done', message: 'Upload accepted' } : result?.status === 'unknown' ? { state: 'failed', message: 'Check the platform' } : { state: 'pending', message: 'Not started' });
      const platformStatus = result?.status === 'processing' ? child(item(node('Platform processing', '◷', { state: 'waiting', message: 'Upload accepted. Check the platform for completion.' }))) : '';
      return item(node(names[platform] || platform, '◎', stage), platformStatus);
    }).join(''), platforms.length > 1);
  }
  function html(job) {
    const saved = job.workflow?.stages || {};
    const legacyDone = job.status === 'ready' ? { state: 'done', message: 'Completed' } : null;
    const stages = ['import', 'captions', 'analysis', 'framing', 'audio', 'editing'].map(key => saved[key] || legacyDone || { state: 'pending', percent: 0 });
    const done = stages.filter(completed).length;
    const known = stages.reduce((sum, stage) => sum + (completed(stage) ? 1 : Number.isFinite(stage.percent) ? stage.percent / 100 : 0), 0) / stages.length * 100;
    let source = 'Video URL'; try { source = new URL(job.url).hostname.replace(/^www\./, ''); } catch {}
    const root = `<div class="wf-node source"><div class="wf-node-title"><span class="wf-icon">▣</span><strong>Source video</strong></div><p>${esc(source)}</p><small>${job.duration ? `${seconds(job.duration)} selected` : job.status === 'queued' ? 'Queued' : 'Video source'}</small></div>`;
    const clips = job.clips?.length ? child(job.clips.map((clip, i) => {
      const stage = job.workflow?.clips?.[clip.id]?.editing || (clip.url ? { state: 'done', message: clip.burnedCaptions ? 'Video + captions exported' : 'Video exported' } : { state: 'pending', message: 'Waiting to encode' });
      const audio = job.workflow?.clips?.[clip.id]?.audio || {state:clip.url?'skipped':'pending',message:clip.audio ? 'Audio mix ready' : clip.url ? 'Original audio exported' : 'Speech, music and sound effects'};
      return item(node(`Clip ${i + 1} · Audio mix`, '♫', audio),child(item(node(`Clip ${i + 1} · Edit & export`, '▧', stage, `<small class="wf-clip-name" title="${esc(clip.title)}">${esc(clip.title)}</small>${clip.url ? `<button class="button secondary small wf-watch" data-preview="${esc(job.id)}" data-clip="${esc(clip.id)}">▷ Watch clip</button>` : ''}`), uploadBranches(job, clip))));
    }).join(''), job.clips.length > 1) : child(item(node('Clip edits', '▧', { state: 'pending', message: 'Clips appear after AI selection' }), child(item(node('Upload', '◎', { state: 'pending', message: 'Available after export' })))));
    const tree = item(root, child(item(node('Import video', '↧', stages[0]), child(item(node('Create captions', '≋', stages[1]), child(item(node('AI clip selection', '✦', stages[2]), child(item(node('Streamer framing', '▣', stages[3]), clips)))))))));
    return `<section class="workflow-view" aria-label="Video processing workflow"><div class="wf-summary"><div><strong>Video workflow</strong><span>${job.status === 'ready' && !job.editing ? 'Clips ready · publishing tracked below' : job.status === 'failed' ? 'Processing stopped' : `${done}/6 processing stages complete`}</span></div><progress value="${known}" max="100" aria-label="Stage completion, not a time estimate"></progress></div><div class="wf-scroll"><ul class="wf-tree">${tree}</ul></div>${job.error ? `<div class="tree-error" role="alert"><strong>Processing stopped</strong><p>${esc(job.error)}</p><button class="button secondary small" data-tree-retry="${esc(job.id)}">Retry from imported video</button></div>` : ''}${!job.workflow && job.status === 'failed' ? '<p class="wf-note">This earlier attempt has no detailed progress log. Retry to see live measurements.</p>' : ''}<p class="wf-note">Percentages come from media tools or bytes sent. AI tasks without measurable progress show “Working”. Upload accepted does not mean platform processing has finished.</p></section>`;
  }
  window.ClipmaxWorkflow = { html };
})();
