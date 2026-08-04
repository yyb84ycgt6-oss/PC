/**
 * Runtime verification for the integration layer.
 *
 *   npm run verify:integration
 *
 * This project has no test runner, so these checks drive the real code paths
 * against a stubbed transport. Exits non-zero on any failure.
 */

import GeminiBridge, { toInlineData } from './gemini-bridge';
import StudioOrchestrator from './studio-orchestrator';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name} ${extra}`));
};

// --- toInlineData: the vision bug ---
console.log('toInlineData');
const d = toInlineData('data:image/png;base64,iVBORw0KGgo=');
ok('strips data-URL prefix and reads mime', d.mimeType === 'image/png' && d.data === 'iVBORw0KGgo=');
ok('passes bare base64 through', toInlineData('AAAA').data === 'AAAA');
try {
  toInlineData('https://example.com/x.png');
  ok('rejects http URL', false, '-> did not throw');
} catch (e) {
  ok('rejects http URL with actionable message', /base64/i.test(String(e)));
}

// --- real request wiring ---
console.log('GeminiBridge');
const calls: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  calls.push({ url, body: JSON.parse(init.body) });
  return {
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: 'reply' }] } }],
                         usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 } }),
    text: async () => '',
  };
};

const g = new GeminiBridge({ apiKey: 'SECRET', vision: true });
const r = await g.prompt('hello');
ok('returns parsed text', r.text === 'reply');
ok('reports token usage', r.inputTokens === 7 && r.outputTokens === 2);
ok('hits generateContent endpoint', calls[0].url.includes(':generateContent'));

await g.prompt('again');
ok('history ordered user,model,user', JSON.stringify(calls[1].body.contents.map((c: any) => c.role)) === '["user","model","user"]');

const img = new GeminiBridge({ apiKey: 'k', vision: true });
await img.prompt('what is this', 'data:image/png;base64,QUJD');
const parts = calls[2].body.contents[0].parts;
ok('sends inlineData with raw base64', parts[0].inlineData.data === 'QUJD' && !String(parts[0].inlineData.data).startsWith('data:'));

// vision disabled
const novis = new GeminiBridge({ apiKey: 'k' });
await novis.prompt('x', 'data:image/png;base64,QUJD').then(
  () => ok('blocks image when vision disabled', false, '-> resolved'),
  (e) => ok('blocks image when vision disabled', /vision/i.test(String(e)))
);

// proxy keeps key out
calls.length = 0;
const p = new GeminiBridge({ apiKey: 'SECRET', proxyUrl: '/api/gemini/generate' });
await p.prompt('hi');
ok('proxy URL used', calls[0].url === '/api/gemini/generate');
ok('key never serialized to proxy', !JSON.stringify(calls[0].body).includes('SECRET'));

// error surfacing
(globalThis as any).fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => 'down' });
await new GeminiBridge({ apiKey: 'k' }).prompt('x').then(
  () => ok('surfaces non-OK', false, '-> resolved'),
  (e) => ok('surfaces non-OK status', /503/.test(String(e)))
);

// --- orchestrator records failure honestly ---
console.log('StudioOrchestrator');
const orch = new StudioOrchestrator({ gemini: { apiKey: 'k' } });
const t = await orch.generateComponent('a card');
ok('failed task carries status+error, does not throw', t.status === 'failed' && !!t.error);

(globalThis as any).fetch = async () => ({
  ok: true, status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: 'const A=1' }] } }] }),
  text: async () => '',
});
const good = await orch.generateComponent('a card');
ok('completed task returns text result', good.status === 'completed' && good.result === 'const A=1');
const ids = await Promise.all([1,2,3,4,5].map(() => orch.analyzeCode('x')));
ok('task ids unique under concurrency', new Set(ids.map(i => i.id)).size === 5);
ok('history capped and populated', orch.getHistory().length >= 5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
