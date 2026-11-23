import { platforms } from './publish.mjs';

export function publishOptions(input = {}) {
  const options = { youtubePrivacy: input.youtubePrivacy || 'private', tiktokPrivacy: input.tiktokPrivacy || 'SELF_ONLY', madeForKids: input.madeForKids === true };
  if (!['private', 'unlisted', 'public'].includes(options.youtubePrivacy) || !['SELF_ONLY', 'PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR'].includes(options.tiktokPrivacy)) throw new Error('Choose valid privacy settings.');
  return options;
}

export function autoUploadSettings(input, accounts, connected) {
  if (input?.enabled !== true) return { enabled: false };
  if (input.consent !== true) throw new Error('Approve automatic uploading to the selected accounts.');
  if (!Array.isArray(input.platforms)) throw new Error('Choose auto-upload destinations.');
  const targets = [...new Set(input.platforms)];
  if (!targets.length || targets.some(p => !platforms.includes(p))) throw new Error('Choose at least one supported auto-upload destination.');
  const accountIds = {};
  for (const platform of targets) {
    const account = accounts.find(a => a.platform === platform && a.active && a.mode !== 'browser');
    if (!account || !connected[platform]) throw new Error(`Connect a verified ${platform} API account before enabling auto-upload. Browser connections require manual posting.`);
    accountIds[platform] = account.id;
  }
  return { enabled: true, state: 'pending', platforms: targets, accountIds, options: publishOptions(input), consent: true };
}

// A project is authorized for the selected account identities, not whichever
// account happens to be active later. Existing projects remain review-first.
export async function maybeAutoUpload(job, { accounts, start, save }) {
  const setting = job.autoUpload;
  if (!setting?.enabled || setting.state !== 'pending' || job.status !== 'ready') return false;
  setting.state = 'checking'; await save(job);
  try {
    if (job.clips.some(clip => clip.contextReviewNeeded)) throw new Error('A clip ending needs review. Watch the clips and finish any incomplete thought before publishing manually.');
    for (const platform of setting.platforms) {
      if (!accounts.some(a => a.id === setting.accountIds[platform] && a.platform === platform && a.active && a.mode !== 'browser')) throw new Error('An auto-upload account was removed or switched. Review your clips and publish manually.');
    }
    await start(job.clips, setting.platforms, setting.options);
    return true;
  } catch (error) {
    setting.state = 'blocked'; setting.message = error.message;
    await save(job); return false;
  }
}
