# AI Studio Integration Guide

Google Gemini wired into the app for component generation, code analysis, debugging, and docs.

- **GeminiBridge** — real `generateContent` calls, text and vision.
- **StudioOrchestrator** — five task flows over one shared lifecycle.
- **useStudio** — the React hook.

---

## 1. Keys and the proxy pattern

**This is a Vite app.** Client code reads `import.meta.env.VITE_*`, not `process.env`, and every
`VITE_*` variable is compiled into the public bundle — so a `VITE_GEMINI_API_KEY` is a published key.

This project already runs an Express server with a `/api/gemini/generate` route. Point the bridge
at it and the key stays server-side:

```ts
const studio = useStudio({
  gemini: {
    proxyUrl: import.meta.env.VITE_GEMINI_PROXY_URL, // '/api/gemini/generate'
    vision: true,
  },
});
```

Passing `apiKey` directly works for local scripts and server-side code — just not a public deploy.

```bash
cp .env.integration.example .env.local
```

---

## 2. GeminiBridge

```ts
import { GeminiBridge } from './src/integration';

const gemini = new GeminiBridge({
  proxyUrl: '/api/gemini/generate',  // or apiKey: '...'
  model: 'gemini-2.0-flash',
  vision: true,
  temperature: 0.7,
  maxOutputTokens: 4096,
});

const res = await gemini.prompt('Explain this pattern');
res.text;         // string
res.inputTokens;  // when reported
```

History is preserved across `prompt()` calls, with assistant turns mapped to `role: 'model'`
as Gemini expects. Use `chat(messages)` for stateless one-shots, `clearHistory()` to reset.

### Vision — images must be base64, not URLs

Gemini's `inlineData` takes raw base64. Handing it an `https://…` link does **not** fetch the
image; it silently produces nonsense. `toInlineData` enforces this:

```ts
import { toInlineData } from './src/integration';

toInlineData('data:image/png;base64,iVBOR…');  // → { mimeType: 'image/png', data: 'iVBOR…' }
toInlineData('https://example.com/a.png');     // throws, telling you to convert first
```

So pass a data URL:

```ts
const dataUrl = await new Promise<string>((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.readAsDataURL(file);   // from an <input type="file">
});

await studio.generateComponent('Build this layout', dataUrl);
```

Sending an image with `vision: false` throws rather than quietly dropping it.

---

## 3. StudioOrchestrator

Every method returns a `StudioTask` and **never throws** — failures arrive as
`status: 'failed'` with `error` set.

```ts
const studio = new StudioOrchestrator({
  gemini: { proxyUrl: '/api/gemini/generate', vision: true },
  maxHistory: 50,
});

await studio.generateComponent('A user profile card', dataUrl?);
await studio.analyzeCode(source);
await studio.enhanceCode(source, 'Add loading and error states');
await studio.debugIssue('Maximum update depth exceeded', 'useEffect writes state it depends on');
await studio.generateDocumentation(source);
```

```ts
task.status;  // 'completed' | 'failed'
task.result;  // string — the model's response
task.error;   // message when failed
```

For anything outside these five flows, reach the bridge directly: `studio.gemini.prompt(...)`.

---

## 4. useStudio

```tsx
import { useStudio } from './src/integration';

function DevTool() {
  const {
    generateComponent, analyzeCode, enhanceCode, debugIssue, generateDocumentation,
    tasks, currentTask, isRunning, error, clearHistory, getStatus,
  } = useStudio({
    gemini: { proxyUrl: import.meta.env.VITE_GEMINI_PROXY_URL, vision: true },
  });

  return (
    <>
      <button disabled={isRunning} onClick={() => generateComponent('A dashboard widget')}>
        {isRunning ? 'Working…' : 'Generate'}
      </button>

      {error && <p className="error">{error}</p>}
      {currentTask && <p>{currentTask.type}: {currentTask.status}</p>}

      {tasks.map((t) => (
        <div key={t.id}>
          {t.type} — {t.status}
          {t.result && <pre>{t.result}</pre>}
        </div>
      ))}
    </>
  );
}
```

The orchestrator is built once via a lazy initializer — it survives re-renders and never updates
state during render.

---

## 5. A full workflow

```ts
const generated = await studio.generateComponent(description);
if (generated.status === 'failed') return void console.error(generated.error);

const analysis = await studio.analyzeCode(generated.result!);
const improved = await studio.enhanceCode(generated.result!, 'Add types and error handling');
const docs     = await studio.generateDocumentation(improved.result!);

studio.orchestrator.getHistory();  // every step, in order
```

---

## 6. Verifying

```bash
npm run lint        # tsc --noEmit
```

The integration was runtime-verified against a stubbed transport covering: data-URL parsing,
URL rejection, history ordering, vision gating, proxy key-safety, non-2xx surfacing, task
failure capture, and id uniqueness under concurrency.

---

## Reference

**GeminiBridge** — `prompt(message, image?)`, `chat(messages)`, `analyzeImage(image, prompt)`,
`clearHistory()`, `getHistory()`

**StudioOrchestrator** — `generateComponent`, `analyzeCode`, `enhanceCode`, `debugIssue`,
`generateDocumentation`, `getTask(id)`, `getHistory(limit?)`, `clearHistory()`, `getStatus()`,
plus the public `gemini` bridge

**useStudio** — `{ isReady, isRunning, tasks, currentTask, error, generateComponent, analyzeCode,
enhanceCode, debugIssue, generateDocumentation, clearHistory, getStatus, orchestrator }`

**Helper** — `toInlineData(image, fallbackMime?)`
