import { readFile } from 'node:fs/promises';
import { uploadBytes } from './upload-progress.mjs';

export const platforms = ['youtube', 'tiktok', 'facebook', 'instagram'];
export function connectionStatus(config = process.env) {
  return {
    youtube: Boolean(config.YOUTUBE_ACCESS_TOKEN),
    tiktok: Boolean(config.TIKTOK_ACCESS_TOKEN),
    facebook: Boolean(config.FACEBOOK_PAGE_ID && config.FACEBOOK_PAGE_ACCESS_TOKEN),
    instagram: Boolean(config.INSTAGRAM_USER_ID && config.INSTAGRAM_ACCESS_TOKEN && config.PUBLIC_MEDIA_BASE_URL)
  };
}
async function request(url, { token, body, method = 'POST', headers = {}, raw = false, onProgress } = {}) {
  const requestHeaders = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(!raw && body ? { 'Content-Type': 'application/json' } : {}), ...headers };
  const response = raw && onProgress ? await uploadBytes(url, { body, method, headers: requestHeaders, onProgress }) : await fetch(url, { method, headers: requestHeaders, body: body ? (raw ? body : JSON.stringify(body)) : undefined, signal: AbortSignal.timeout(180000) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = {}; }
  if (!response.ok || data.error && data.error.code !== 'ok') throw new Error(`Platform request failed (${response.status}): ${String(data.error?.message || response.statusText).slice(0, 300)}`);
  return { data, response };
}
const pause = ms => new Promise(r => setTimeout(r, ms));
export async function publish(platform, job, clip, path, options, config = process.env, onProgress = () => {}) {
  if (!connectionStatus(config)[platform]) throw new Error(`Add a ${platform} account in Connections first.`);
  const title = clip.title, caption = clip.caption;
  onProgress({ percent: null, message: 'Preparing platform upload' });
  if (platform === 'youtube') {
    const token = config.YOUTUBE_ACCESS_TOKEN;
    const bytes = await readFile(path);
    const { response } = await request('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { token, body: { snippet: { title, description: caption, categoryId: '22' }, status: { privacyStatus: options.youtubePrivacy, selfDeclaredMadeForKids: options.madeForKids } }, headers: { 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(bytes.length) } });
    const target = response.headers.get('location');
    if (!target || new URL(target).hostname !== 'www.googleapis.com') throw new Error('Unexpected YouTube upload destination.');
    const { data } = await request(target, { token, method: 'PUT', body: bytes, raw: true, headers: { 'Content-Type': 'video/mp4' }, onProgress: progress => onProgress({ ...progress, message: 'Sending video bytes' }) });
    return { status: 'uploaded', id: data.id, url: `https://www.youtube.com/watch?v=${data.id}` };
  }
  if (platform === 'tiktok') {
    const token = config.TIKTOK_ACCESS_TOKEN;
    const { data: creator } = await request('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', { token, body: {} });
    if (!creator.data?.privacy_level_options?.includes(options.tiktokPrivacy)) throw new Error('This TikTok account does not support the selected privacy.');
    if (clip.end - clip.start > creator.data.max_video_post_duration_sec) throw new Error('Clip exceeds this TikTok creator’s duration limit.');
    const bytes = await readFile(path);
    // One chunk up to 64 MB. Exports above this are rejected rather than corrupted.
    if (bytes.length > 64 * 1024 * 1024) throw new Error('TikTok upload exceeds 64 MB. Export a shorter clip.');
    const { data } = await request('https://open.tiktokapis.com/v2/post/publish/video/init/', { token, body: { post_info: { title: `${title}\n${caption}`.slice(0, 2200), privacy_level: options.tiktokPrivacy, disable_duet: true, disable_stitch: true, disable_comment: true }, source_info: { source: 'FILE_UPLOAD', video_size: bytes.length, chunk_size: bytes.length, total_chunk_count: 1 } } });
    const target = new URL(data.data.upload_url);
    if (target.protocol !== 'https:' || !(target.hostname === 'tiktokapis.com' || target.hostname.endsWith('.tiktokapis.com'))) throw new Error('Unexpected TikTok upload destination.');
    await request(target, { method: 'PUT', body: bytes, raw: true, headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` }, onProgress: progress => onProgress({ ...progress, message: 'Sending video bytes' }) });
    return { status: 'processing', id: data.data.publish_id };
  }
  const version = config.META_API_VERSION || 'v27.0';
  if (platform === 'facebook') {
    const token = config.FACEBOOK_PAGE_ACCESS_TOKEN, page = config.FACEBOOK_PAGE_ID;
    const endpoint = `https://graph.facebook.com/${version}/${encodeURIComponent(page)}/video_reels`;
    const { data } = await request(endpoint, { token, body: { upload_phase: 'start' } });
    const bytes = await readFile(path), target = new URL(data.upload_url);
    if (target.protocol !== 'https:' || target.hostname !== 'rupload.facebook.com') throw new Error('Unexpected Facebook upload destination.');
    await request(target, { token, raw: true, body: bytes, headers: { offset: '0', file_size: String(bytes.length), 'Content-Type': 'application/octet-stream' }, onProgress: progress => onProgress({ ...progress, message: 'Sending video bytes' }) });
    onProgress({ percent: null, message: 'Facebook is accepting the upload' });
    await request(endpoint, { token, body: { upload_phase: 'finish', video_id: data.video_id, video_state: 'PUBLISHED', title, description: caption } });
    return { status: 'processing', id: data.video_id };
  }
  if (platform === 'instagram') {
    const token = config.INSTAGRAM_ACCESS_TOKEN, user = config.INSTAGRAM_USER_ID;
    const media = new URL(`${config.PUBLIC_MEDIA_BASE_URL.replace(/\/$/, '')}/${job.id}/${clip.id}.mp4`);
    if (media.protocol !== 'https:') throw new Error('Instagram needs a public HTTPS media host.');
    const base = `https://graph.instagram.com/${version}`;
    const { data } = await request(`${base}/${encodeURIComponent(user)}/media`, { token, body: { media_type: 'REELS', video_url: media.href, caption: `${title}\n${caption}` } });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const { data: state } = await request(`${base}/${data.id}?fields=status_code`, { token, method: 'GET' });
      onProgress({ percent: null, message: `Instagram processing: ${state.status_code || 'waiting'}` });
      if (state.status_code === 'FINISHED') { ready = true; break; }
      if (['ERROR', 'EXPIRED'].includes(state.status_code)) throw new Error('Instagram could not process this video. Check your public media URL.');
      await pause(3000);
    }
    if (!ready) throw new Error('Instagram processing timed out. Check Instagram before retrying.');
    const { data: posted } = await request(`${base}/${encodeURIComponent(user)}/media_publish`, { token, body: { creation_id: data.id } });
    return { status: 'published', id: posted.id };
  }
  throw new Error('Unsupported platform.');
}
