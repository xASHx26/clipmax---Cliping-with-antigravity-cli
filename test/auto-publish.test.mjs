import test from 'node:test';
import assert from 'node:assert/strict';
import { autoUploadSettings, maybeAutoUpload, publishOptions } from '../lib/auto-publish.mjs';

const accounts = [{ id: 'channel-a', platform: 'youtube', active: true, mode: 'api' }, { id: 'creator-a', platform: 'tiktok', active: true, mode: 'api' }];
const connected = { youtube: true, tiktok: true };
const input = { enabled: true, consent: true, platforms: ['youtube', 'tiktok'], youtubePrivacy: 'unlisted' };
const options = () => autoUploadSettings(input, accounts, connected);

test('review-first is the default and automatic uploads require consent and every selected API connection', () => {
  assert.deepEqual(autoUploadSettings(undefined, accounts, connected), { enabled: false });
  assert.deepEqual(autoUploadSettings({ enabled: 'false' }, accounts, connected), { enabled: false });
  assert.throws(() => autoUploadSettings({ ...input, consent: false }, accounts, connected), /Approve/);
  assert.throws(() => autoUploadSettings(input, accounts, { youtube: true }), /tiktok/);
  assert.throws(() => autoUploadSettings(input, accounts.map(a => ({ ...a, mode: 'browser' })), connected), /verified/);
  assert.throws(() => autoUploadSettings({ ...input, platforms: [] }, accounts, connected));
  assert.deepEqual(options().accountIds, { youtube: 'channel-a', tiktok: 'creator-a' });
  assert.equal(options().options.youtubePrivacy, 'unlisted');
  assert.equal(publishOptions().tiktokPrivacy, 'SELF_ONLY');
  assert.throws(() => publishOptions({ youtubePrivacy: 'invalid' }));
});

test('auto-upload waits until clips are ready, launches once, and leaves review-first projects untouched', async () => {
  const calls = [], saves = [];
  const deps = { accounts, save: async j => saves.push(j.autoUpload?.state), start: async (...args) => calls.push(args) };
  assert.equal(await maybeAutoUpload({ status: 'ready', clips: [] }, deps), false);
  const job = { status: 'rendering', autoUpload: options(), clips: [{ id: 'clip-1' }] };
  assert.equal(await maybeAutoUpload(job, deps), false);
  job.status = 'ready';
  await Promise.all([maybeAutoUpload(job, deps), maybeAutoUpload(job, deps)]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [job.clips, ['youtube', 'tiktok'], options().options]);
  assert.deepEqual(saves, ['checking']);
});

test('an account switch or failed readiness check blocks the entire automatic batch', async () => {
  let calls = 0;
  const job = { status: 'ready', autoUpload: options(), clips: [{ id: 'clip-1' }] };
  await maybeAutoUpload(job, { accounts: accounts.filter(a => a.platform !== 'tiktok'), save: async () => {}, start: async () => calls++ });
  assert.equal(calls, 0); assert.equal(job.autoUpload.state, 'blocked');
  const failed = { ...job, autoUpload: options() };
  await maybeAutoUpload(failed, { accounts, save: async () => {}, start: async () => { throw new Error('Refresh required'); } });
  assert.equal(failed.autoUpload.state, 'blocked'); assert.equal(failed.autoUpload.message, 'Refresh required');
  await maybeAutoUpload(failed, { accounts, save: async () => {}, start: async () => calls++ });
  assert.equal(calls, 0);
});
