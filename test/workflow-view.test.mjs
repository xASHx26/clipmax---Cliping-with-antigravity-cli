import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const context = { window: {}, URL, Date }; vm.createContext(context);
vm.runInContext(await readFile(new URL('../public/workflow.js', import.meta.url), 'utf8'), context);
const html = context.window.ClipmaxWorkflow.html;
test('workflow branches by clip and platform, with no false browser-upload percentage', () => {
  const job = { status: 'ready', url: 'https://youtu.be/example', clips: [{ id: 'clip-1', title: '<script>bad</script>', url: '/clip-1.mp4', publications: { youtube: { status: 'processing' } } }, { id: 'clip-2', title: 'Second', url: '/clip-2.mp4', browserHandoffs: { tiktok: { status: 'awaiting_browser' } } }] };
  const result = html(job);
  assert.ok(result.includes('Clip 1 · Edit &amp; export'));
  assert.ok(result.includes('Clip 2 · Edit &amp; export'));
  assert.ok(result.includes('YouTube'));
  assert.ok(result.includes('data-preview='));
  assert.ok(result.includes('Watch clip'));
  assert.ok(result.includes('Your action needed'));
  assert.ok(result.includes('Finish posting in browser'));
  assert.ok(result.includes('Platform processing'));
  assert.ok(!result.includes('<script>bad</script>'));
});
test('AI without telemetry has indeterminate progress rather than an invented percent', () => {
  const result = html({ status: 'analyzing', clips: [], workflow: { stages: { analysis: { state: 'running', percent: null, message: 'AI choosing clips' } } } });
  assert.match(result, /<progress max="100"  aria-label="AI clip selection progress">/);
  assert.ok(result.includes('Working…'));
});

test('failed projects expose the escaped error and a retry action on the tree page', () => {
  const result = html({ id: 'test-project', status: 'failed', clips: [], error: 'Speech failed <audio>' });
  assert.ok(result.includes('role="alert"'));
  assert.ok(result.includes('Speech failed &lt;audio&gt;'));
  assert.ok(result.includes('data-tree-retry="test-project"'));
});
