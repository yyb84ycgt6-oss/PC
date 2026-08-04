# AI Studio Integration Module

Google Gemini wired in for component generation, code analysis, debugging, and docs.

📖 **Full guide:** [`INTEGRATION_GUIDE.md`](../../INTEGRATION_GUIDE.md)

```
gemini-bridge.ts        Real generateContent calls, text + vision, proxy support
studio-orchestrator.ts  Five task flows over one shared lifecycle
useStudio.ts            React hook
```

## 60-second start

```tsx
import { useStudio } from './src/integration';

const { generateComponent, analyzeCode, tasks, isRunning, error } = useStudio({
  gemini: { proxyUrl: import.meta.env.VITE_GEMINI_PROXY_URL, vision: true },
});

await generateComponent('A user profile card');
```

## Three things worth knowing

**1. Keys belong on the server.** This is a Vite app — every `VITE_*` var ships in the public
bundle. `server.ts` already exposes `/api/gemini/generate`; use `proxyUrl` to route through it.

**2. Vision takes base64, not URLs.** Gemini's `inlineData` will not fetch an `https://` link — it
silently returns nonsense. Pass a data URL; `toInlineData` throws on a plain URL rather than
letting the mistake through.

**3. Tasks never throw.** Failures come back as `status: 'failed'` with `error` set, so one bad
call can't take down the UI.

## Task flows

| Method | Does |
|---|---|
| `generateComponent(desc, image?)` | React + TypeScript + Tailwind component |
| `analyzeCode(code)` | Structure, bugs, performance, best-practice gaps |
| `enhanceCode(code, ask)` | Targeted improvement |
| `debugIssue(issue, context?)` | Diagnosis and fix |
| `generateDocumentation(code)` | Purpose, params, examples, edge cases |

Anything else: `orchestrator.gemini.prompt(...)`.

## Verify

```bash
npm run lint   # tsc --noEmit
```
