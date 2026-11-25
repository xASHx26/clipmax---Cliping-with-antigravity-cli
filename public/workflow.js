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
    const label = completed(stage) ? 'Complete' : running ? determinate ? `${stage.estimatedTotal ? '~' : ''}${Math.floor(value)}%` : 'Working…' : state === 'failed' ? 'Stopped' : state === 'cancelled' ? 'Cancelled' : state === 'waiting' ? 'Your action needed' : 'Waiting';
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
    const metadataStage = saved.metadata || (job.clips?.length && job.clips.every(c => c.publicationMetadata) ? {state:'done',message:'AI title, description and tags ready'} : {state:'pending',message:'Generated before publishing'});
    const publishingDetails = child(item(node('Publishing details', '✎', metadataStage), clips));
    const soundReview = child(item(node('Mood & sound direction', '♫', saved.soundDirection || {state:'skipped',message:'Transcript-based sound guidance'}), publishingDetails));
    const tree = item(root, child(item(node('Import video', '↧', stages[0]), child(item(node('Create captions', '≋', stages[1]), child(item(node('AI clip selection', '✦', stages[2]), child(item(node('Streamer framing', '▣', stages[3]), soundReview)))))))));
    return `<section class="workflow-view" aria-label="Video processing workflow"><div class="wf-summary"><div><strong>Video workflow</strong><span>${job.status === 'ready' && !job.editing ? 'Clips ready · publishing tracked below' : job.cancelling ? 'Cancelling…' : job.status === 'cancelled' ? 'Cancelled' : job.status === 'paused' ? 'Waiting for AI quota' : job.status === 'failed' ? 'Processing stopped' : `${done}/6 processing stages complete`}</span></div><progress value="${known}" max="100" aria-label="Stage completion, not a time estimate"></progress></div>${job.canCancel && !job.publishing ? `<button class="button secondary small" data-cancel="${esc(job.id)}" ${job.cancelling?'disabled':''}>${job.cancelling?'Cancelling…':'Cancel project'}</button>` : ''}${job.status==='paused'?`<p class="notice">${esc(job.pauseReason || 'Waiting for AI quota. Video and captions are saved.')} <button class="button secondary small" data-tree-retry="${esc(job.id)}">Resume AI</button></p>`:''}${job.status==='cancelled'?`<p class="notice">Cancelled. Saved media is kept. <button class="button secondary small" data-tree-retry="${esc(job.id)}">Retry project</button></p>`:''}<div class="wf-scroll"><ul class="wf-tree">${tree}</ul></div>${job.error ? `<div class="tree-error" role="alert"><strong>Processing stopped</strong><p>${esc(job.error)}</p><button class="button secondary small" data-tree-retry="${esc(job.id)}">Retry from imported video</button></div>` : ''}${!job.workflow && job.status === 'failed' ? '<p class="wf-note">This earlier attempt has no detailed progress log. Retry to see live measurements.</p>' : ''}<p class="wf-note">Percentages come from media tools or bytes sent. AI tasks without measurable progress show “Working”. Upload accepted does not mean platform processing has finished.</p></section>`;
  }
  function activity(job) {
    const stages = job.workflow?.stages || {}, metadata = stages.metadata;
    const processing = ['queued','importing','transcribing','analyzing','rendering'].includes(job.status);
    if (!processing && !job.editing && !job.publishing) return '';
    let current = job.cancelling ? {percent:null,message:'Stopping active processes and keeping saved media'} : undefined, title = job.cancelling ? 'Cancelling project' : undefined;
    if (job.publishing && !job.cancelling) {
      const uploads = Object.entries(job.workflow?.clips || {}).flatMap(([id, values]) => Object.entries(values).filter(([key,value]) => key.startsWith('upload:') && value.state === 'running').map(([key,value]) => ({...value, id, platform:key.slice(7)})));
      current = uploads.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0];
      if (current) title = `Uploading ${current.id.replace('clip-','clip ')} to ${names[current.platform] || current.platform}`;
    }
    if (!current && metadata?.state === 'running') { current = metadata; title = 'AI title, description & tags'; }
    if (!current) {
      current = Object.entries(stages).filter(([key,value])=> key !== 'metadata' && value.state === 'running').map(([key,value])=>({...value,key})).sort((a,b)=>(b.startedAt||0)-(a.startedAt||0))[0] || {};
      title = current.key==='soundDirection' ? 'Listening to clip audio & planning sound' : job.publishing ? 'Preparing uploads' : job.status === 'queued' ? 'Waiting for processing' : job.editing ? 'Saving your clip' : ({importing:'Importing video',transcribing:'Creating AI captions',analyzing:'Finding complete stories',rendering:'Editing & exporting clips'}[job.status] || 'Working');
    }
    const measured = Number.isFinite(current.percent), value = Math.max(0, Math.min(99.9, current.percent || 0));
    const metrics = Number.isFinite(current.bytes) && current.totalBytes ? `${bytes(current.bytes)} / ${bytes(current.totalBytes)}` : current.mediaTotal && Number.isFinite(current.mediaSeconds) ? `${seconds(current.mediaSeconds)} / ${seconds(current.mediaTotal)}` : '';
    return `<div class="project-activity"><div class="activity-heading"><strong>${esc(title)}</strong><span>${measured ? `${Math.floor(value)}%` : 'Working…'}</span></div><progress class="${measured ? '' : 'activity-indeterminate'}" max="100" ${measured ? `value="${value}"` : ''} aria-label="${esc(title)} progress"></progress><div class="activity-caption"><span>${esc(current.message || (job.publishing ? 'Connecting to your selected accounts' : 'Waiting for the next process update'))}</span><small>${esc(metrics)}</small></div></div>`;
  }
  function uploadProgress(job, watch) {
    const rows = (watch.clipIds || []).flatMap(id => (watch.platforms || []).map(platform => {
      const clip = job?.clips?.find(clip => clip.id === id), result = clip?.publications?.[platform];
      const stage = job?.workflow?.clips?.[id]?.[`upload:${platform}`] || {};
      const accepted = ['uploaded','processing','published'].includes(result?.status);
      const failed = ['failed','unknown'].includes(result?.status) || stage.state === 'failed';
      const waiting = result?.status === 'action_required' || stage.state === 'waiting';
      const running = !accepted && !failed && !waiting && (stage.state === 'running' || result?.status === 'uploading');
      const measured = Number.isFinite(stage.percent);
      const percent = accepted ? 100 : measured ? Math.max(0, Math.min(99.9, stage.percent)) : 0;
      const state = accepted ? 'accepted' : failed ? 'failed' : waiting ? 'waiting' : running ? 'running' : 'queued';
      const label = accepted ? result.status === 'published' ? 'Published' : 'Upload accepted' : failed ? result?.status === 'unknown' ? 'Check platform · outcome unknown' : 'Upload failed' : waiting ? 'Your action needed' : running ? measured ? `${Math.floor(percent)}% uploaded` : 'Preparing upload…' : 'Queued';
      const message = accepted ? result.status === 'published' ? 'Live on the platform' : 'The platform may still be processing the video.' : result?.error || stage.message || 'Waiting for an upload slot';
      return {id,platform,clip,result,state,running,measured,percent,label,message};
    }));
    const accepted = rows.filter(row => row.state === 'accepted').length;
    const attention = rows.some(row => ['failed','waiting'].includes(row.state));
    const finished = !watch.requestPending && !job?.publishing;
    const metadata = job?.workflow?.stages?.metadata;
    const preparing = watch.requestPending || metadata?.state === 'running';
    const unknown = rows.some(row => row.running && !row.measured) || preparing && !rows.some(row => row.running);
    const value = rows.length ? rows.reduce((sum,row) => sum + row.percent,0) / rows.length : 0;
    const heading = watch.error ? 'Publishing needs attention' : finished ? accepted === rows.length && rows.length ? 'Uploads accepted' : 'Publishing needs attention' : metadata?.state === 'running' ? 'Writing AI publishing details' : rows.some(row=>row.running) ? 'Uploading your clips' : 'Preparing your uploads';
    const summary = watch.error || `${accepted} of ${rows.length} uploads accepted${finished && attention ? ' · review the results below' : ''}`;
    const errors=[...new Set(rows.filter(row=>row.state==='failed').map(row=>row.message))];
    const rejection=errors.some(error=>/exceeded the number of videos|uploadLimitExceeded/i.test(error)) ? 'YouTube’s daily channel upload limit has been reached. YouTube recommends trying again in 24 hours. Reconnecting does not reset this limit.' : errors.join(' · ');
    return `<div class="upload-overall"><div><h3>${esc(heading)}</h3><span>${watch.error ? 'Review needed' : !unknown ? `${Math.floor(value)}%` : 'Working…'}</span></div><progress max="100" ${unknown ? '' : `value="${value}"`} aria-label="Selected uploads progress"></progress><p role="status">${esc(summary)}</p>${metadata?.state==='running'?`<small>${esc(metadata.message || 'Gemini is preparing titles, descriptions and tags.')}</small>`:''}</div>${rejection ? `<div class="upload-error" role="alert">${esc(rejection)}</div>` : ''}<div class="upload-progress-list">${rows.map(row => `<article class="upload-progress-row ${row.state}"><div class="upload-row-heading"><strong>${esc(row.clip?.title || row.id)}</strong><span>${esc(names[row.platform] || row.platform)}</span></div><div class="upload-row-state"><span>${esc(row.label)}</span><small>${Number.isFinite(job?.workflow?.clips?.[row.id]?.[`upload:${row.platform}`]?.bytes) ? esc(bytes(job.workflow.clips[row.id][`upload:${row.platform}`].bytes))+' sent' : ''}</small></div><progress max="100" ${row.running&&!row.measured?'':`value="${row.percent}"`} aria-label="${esc(row.id+' '+(names[row.platform]||row.platform))} upload progress"></progress><p>${esc(row.message)}</p>${row.result?.url && /^https:\/\//.test(row.result.url) ? `<a href="${esc(row.result.url)}" target="_blank" rel="noopener">View on ${esc(names[row.platform]||row.platform)}</a>` : ''}</article>`).join('')}</div><p class="muted upload-progress-note">Keep Clipmax open until the uploads are accepted. You can close this panel and keep working; progress stays available on the project.</p>`;
  }
  function uploadFailure(job) {
    const errors=(job.clips||[]).flatMap(clip=>Object.entries(clip.publications||{}).filter(([,result])=>['failed','unknown'].includes(result.status)).map(([platform,result])=>`${names[platform]||platform}: ${result.error||'Upload outcome unknown; check the platform.'}`));
    if(!errors.length)return '';
    const limit=errors.some(error=>/exceeded the number of videos|uploadLimitExceeded/i.test(error));
    return `<div class="upload-error" role="alert"><strong>${limit?'YouTube daily upload limit reached':'Publishing needs attention'}</strong><p>${esc(limit?'YouTube rejected the upload because the channel reached its daily upload limit. Try again in 24 hours; reconnecting will not reset the limit.':[...new Set(errors)].join(' · '))}</p><button class="button secondary small" data-upload-progress="${esc(job.id)}">View upload results</button></div>`;
  }
  window.ClipmaxWorkflow = { html, activity, uploadProgress, uploadFailure };
})();
