import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Cpu, Send, Plus, Trash2, Cloud, HardDrive, Loader2, Zap, Activity,
    MessageSquare, ChevronRight, RefreshCw, Wrench, Circle, Scissors,
    Shield, Save, Search, AlertTriangle, Archive
} from 'lucide-react';
import { getAiClient, MODEL_NAME } from '../../lib/gemini';

/**
 * FUSION — Phase 2
 * "One brain, many hands." A single conversational surface that routes to a
 * local brain (Ollama hardware) first and falls back to the cloud (Gemini)
 * automatically. Three calm zones: Memory · Conversation · Live Canvas.
 *
 * Phase 1 shipped: the shell, one real routed chat, the unified vault.
 * Phase 2 (this): the TOOL BUS — the AI's first real hands. compress /
 * scan_threat / save_to_vault / recall run genuine logic (reusing JackyV3's
 * prism-compression and threat-scan engines) and render results in the Live
 * Canvas. Invoke by clicking a tool chip or with a /slash command.
 */

type Brain = 'local' | 'cloud';

interface FMessage {
    role: 'user' | 'assistant';
    content: string;
    brain?: Brain;
    fellBack?: boolean;
    error?: boolean;
    tool?: string;
    ts: number;
}

interface FConversation {
    id: string;
    title: string;
    messages: FMessage[];
    createdAt: number;
}

interface VaultArtifact {
    id: string;
    kind: 'note' | 'compression' | 'scan';
    title: string;
    content: string;
    createdAt: number;
}

interface FVault {
    version: 2;
    conversations: FConversation[];
    artifacts: VaultArtifact[];
    activeId: string | null;
    preferLocal: boolean;
    ollamaEndpoint: string;
    ollamaModel: string;
}

const VAULT_KEY = 'fusion_vault_v1';

const SYSTEM_PROMPT = `You are the unified intelligence of a local-first developer OS — one mind speaking for the whole machine. You are direct, warm, and technically deep with zero fluff. Lead with the answer; add depth only when it earns its place, so a human is never overwhelmed. You are offline-first and privacy-respecting. You have real tools on your bus: compress (squeeze text), scan_threat (audit a message for scams/phishing), save_to_vault (remember something), recall (search memory). When a request maps to one of these, tell the user which tool fits and that they can run it from the tool chips or a /command. Keep the human oriented at all times.`;

// --- Threat-scan heuristics (ported from JackyV3's real scanner) -------------
const SCAM_PATTERNS = [
    { name: 'Urgency Trap', indicators: ['act now', 'limited time', 'urgent', 'only today', 'expires'], context: 'Artificial time pressure bypasses rational analysis' },
    { name: 'Authority Impersonation', indicators: ['official', 'from your bank', 'support team', 'verified account'], context: 'Mimics trust without verifiable proof' },
    { name: 'Link Obfuscation', indicators: ['bit.ly', 'tinyurl', 'click here', 'verify here', 'shortened'], context: 'Hides true destination from inspection' },
    { name: 'Reciprocity Trap', indicators: ['free gift', 'you owe', 'special offer', 'bonus', 'reward'], context: 'Creates psychological debt to lower resistance' },
    { name: 'Social Proof Fabrication', indicators: ['thousands agree', 'everyone is doing', 'trusted by millions'], context: 'Invents consensus to exploit conformity' },
    { name: 'Data Harvest Pretext', indicators: ['verify identity', 'confirm details', 'update information', 'security check'], context: 'Requests sensitive data under false legitimacy' },
    { name: 'Emotional Exploitation', indicators: ['you\'ve won', 'congratulations', 'you\'re selected', 'winner'], context: 'Targets emotional centers to bypass logic' },
    { name: 'Crypto Pump', indicators: ['guaranteed returns', 'no risk', 'get rich', 'proven system', '100x', 'risk-free'], context: 'Promises impossible returns in high-risk assets' },
];
const LEVEL_COLOR: Record<string, string> = { EXTREME: '#f0596a', HIGH: '#f08a3a', MEDIUM: '#f0b429', LOW: '#4ade80' };

const COMPRESS_PROMPT = (text: string) => `You are a semantic compression engine. Strip all conversational fluff, throat-clearing, redundant explanation, preachy warnings, and noise. Condense to absolute core meaning at 100% informational fidelity. Output ONLY the compressed result as tight structured bullets — no intro, no closing remarks.

INPUT:
"${text}"`;

const SCAN_PROMPT = (text: string) => `You are a predatory-pattern / scam scanner. Examine this message:
"${text}"

Return ONLY a raw JSON object, no markdown:
{
  "aiLevel": "EXTREME" | "HIGH" | "MEDIUM" | "LOW",
  "aiRationale": "1-2 sentence diagnostic of the hidden mechanism",
  "countermeasures": ["direct tip 1", "direct tip 2"]
}`;

const PENDING_NEXT = [
    { name: 'send_telegram', lineage: 'server.ts', phase: 'Phase 3' },
    { name: 'run_task', lineage: 'SuperSayen', phase: 'Phase 3' },
];

const newConversation = (): FConversation => ({
    id: `c_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
    title: 'New session',
    messages: [],
    createdAt: Date.now(),
});

const defaultVault = (): FVault => {
    const c = newConversation();
    return {
        version: 2,
        conversations: [c],
        artifacts: [],
        activeId: c.id,
        preferLocal: false,
        ollamaEndpoint: 'http://localhost:11434',
        ollamaModel: 'llama3.2',
    };
};

const loadVault = (): FVault => {
    try {
        const raw = localStorage.getItem(VAULT_KEY);
        if (!raw) return defaultVault();
        const parsed = JSON.parse(raw);
        if (!parsed.conversations || parsed.conversations.length === 0) return defaultVault();
        return { ...defaultVault(), ...parsed, artifacts: parsed.artifacts || [] };
    } catch {
        return defaultVault();
    }
};

interface RouteInfo {
    brain: Brain | null;
    fellBack: boolean;
    latencyMs: number | null;
    chars: number | null;
    note: string;
}

type ToolResult =
    | { tool: 'compress'; inChars: number; outChars: number; ratioPct: number; text: string; ts: number }
    | { tool: 'scan'; level: string; score: string; hits: { name: string; context: string }[]; rationale: string; countermeasures: string[]; ts: number }
    | { tool: 'vault'; action: 'saved' | 'search'; entries: VaultArtifact[]; query?: string; ts: number };

export const FusionApp: React.FC = () => {
    const [vault, setVault] = useState<FVault>(loadVault);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<'idle' | 'routing' | 'thinking'>('idle');
    const [route, setRoute] = useState<RouteInfo>({ brain: null, fellBack: false, latencyMs: null, chars: null, note: 'Awaiting first transmission.' });
    const [toolBusy, setToolBusy] = useState<string | null>(null);
    const [toolResult, setToolResult] = useState<ToolResult | null>(null);

    const endRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        try { localStorage.setItem(VAULT_KEY, JSON.stringify(vault)); }
        catch (e) { console.warn('Fusion vault save failed:', e); }
    }, [vault]);

    const active = vault.conversations.find(c => c.id === vault.activeId) || vault.conversations[0];

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [active?.messages.length, busy, toolBusy]);

    // --- vault mutations -----------------------------------------------------
    const patchActive = useCallback((mut: (c: FConversation) => FConversation) => {
        setVault(v => ({ ...v, conversations: v.conversations.map(c => (c.id === v.activeId ? mut(c) : c)) }));
    }, []);

    const pushMsg = useCallback((m: FMessage) => {
        patchActive(c => ({
            ...c,
            title: c.messages.length === 0 && m.role === 'user' ? m.content.slice(0, 42) : c.title,
            messages: [...c.messages, m],
        }));
    }, [patchActive]);

    const createSession = () => {
        const c = newConversation();
        setVault(v => ({ ...v, conversations: [c, ...v.conversations], activeId: c.id }));
        setRoute(r => ({ ...r, note: 'New session opened.' }));
    };
    const selectSession = (id: string) => setVault(v => ({ ...v, activeId: id }));
    const deleteSession = (id: string) => {
        setVault(v => {
            const remaining = v.conversations.filter(c => c.id !== id);
            if (remaining.length === 0) {
                const c = newConversation();
                return { ...v, conversations: [c], activeId: c.id };
            }
            return { ...v, conversations: remaining, activeId: v.activeId === id ? remaining[0].id : v.activeId };
        });
    };
    const setPreferLocal = (preferLocal: boolean) => setVault(v => ({ ...v, preferLocal }));
    const addArtifact = (a: VaultArtifact) => setVault(v => ({ ...v, artifacts: [a, ...v.artifacts].slice(0, 200) }));

    // --- model calls ---------------------------------------------------------
    const callCloud = async (history: FMessage[]): Promise<string> => {
        const ai = getAiClient();
        const contents = `${SYSTEM_PROMPT}\n\n` +
            history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') + `\nAssistant:`;
        const response = await ai.models.generateContent({ model: MODEL_NAME, contents, config: { temperature: 0.7 } });
        const text = (response.text || '').trim();
        if (!text) throw new Error('Empty cloud response');
        return text;
    };
    const callLocal = async (history: FMessage[]): Promise<string> => {
        const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history.map(m => ({ role: m.role, content: m.content }))];
        const res = await fetch('/api/ollama/real', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages, customEndpoint: vault.ollamaEndpoint, model: vault.ollamaModel }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.response) throw new Error(data.error || `Local brain unreachable (${res.status})`);
        return String(data.response).trim();
    };

    // single-prompt model call used by tools (route-aware, local-first with fallback)
    const askModel = async (prompt: string, temperature = 0.2): Promise<string> => {
        if (vault.preferLocal) {
            try {
                const res = await fetch('/api/ollama/real', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], customEndpoint: vault.ollamaEndpoint, model: vault.ollamaModel, options: { temperature } }),
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.response) return String(data.response).trim();
            } catch { /* fall through to cloud */ }
        }
        const ai = getAiClient();
        const r = await ai.models.generateContent({ model: MODEL_NAME, contents: prompt, config: { temperature } });
        return (r.text || '').trim();
    };

    // --- TOOLS ---------------------------------------------------------------
    const runCompress = async (text: string) => {
        if (!text.trim() || toolBusy || busy) return;
        pushMsg({ role: 'user', content: text, tool: 'compress', ts: Date.now() });
        setToolBusy('compress');
        try {
            const out = await askModel(COMPRESS_PROMPT(text), 0.15);
            const inChars = text.length, outChars = out.length;
            const ratioPct = inChars > 0 ? Math.max(0, Math.round(((inChars - outChars) / inChars) * 100)) : 0;
            setToolResult({ tool: 'compress', inChars, outChars, ratioPct, text: out, ts: Date.now() });
            addArtifact({ id: `a_${Date.now()}`, kind: 'compression', title: text.slice(0, 40), content: out, createdAt: Date.now() });
            pushMsg({ role: 'assistant', content: `Compressed ${inChars.toLocaleString()} → ${outChars.toLocaleString()} chars (−${ratioPct}% noise). Result in the canvas → and saved to your vault.`, tool: 'compress', ts: Date.now() });
        } catch (err: any) {
            pushMsg({ role: 'assistant', content: `⚠️ Compress failed: ${err?.message || 'unknown error'}.`, error: true, tool: 'compress', ts: Date.now() });
        } finally { setToolBusy(null); }
    };

    const runScan = async (text: string) => {
        if (!text.trim() || toolBusy || busy) return;
        pushMsg({ role: 'user', content: text, tool: 'scan_threat', ts: Date.now() });
        setToolBusy('scan_threat');

        // local heuristics always run — the scanner works even with no model.
        const low = text.toLowerCase();
        const hits: { name: string; context: string }[] = [];
        let score = 0;
        SCAM_PATTERNS.forEach(p => {
            const m = p.indicators.filter(i => low.includes(i));
            if (m.length) { hits.push({ name: p.name, context: p.context }); score += m.length * 0.9; }
        });
        let level = score > 5 ? 'EXTREME' : score > 3 ? 'HIGH' : score > 1 ? 'MEDIUM' : 'LOW';
        let rationale = 'On-board pattern matching flagged the vectors above.';
        let countermeasures = ['Do not reply or click any links.', 'Verify the sender through an independent channel.'];

        try {
            const out = await askModel(SCAN_PROMPT(text), 0.1);
            const jsonMatch = out.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.aiLevel) level = parsed.aiLevel;
                if (parsed.aiRationale) rationale = parsed.aiRationale;
                if (Array.isArray(parsed.countermeasures) && parsed.countermeasures.length) countermeasures = parsed.countermeasures;
            }
        } catch { /* keep local-only result */ }

        const scoreStr = (level === 'EXTREME' ? Math.max(score, 8.5) : level === 'HIGH' ? Math.max(score, 6) : level === 'MEDIUM' ? Math.max(score, 3) : Math.max(score, 0.5)).toFixed(1);
        setToolResult({ tool: 'scan', level, score: scoreStr, hits: hits.length ? hits : [{ name: 'No known pattern matched', context: 'Model judgement only — stay alert.' }], rationale, countermeasures, ts: Date.now() });
        addArtifact({ id: `a_${Date.now()}`, kind: 'scan', title: `Scan: ${text.slice(0, 32)}`, content: `${level} (${scoreStr}/10) — ${rationale}`, createdAt: Date.now() });
        pushMsg({ role: 'assistant', content: `Threat scan complete: ${level} risk (${scoreStr}/10). ${rationale} Full report in the canvas →`, tool: 'scan_threat', ts: Date.now() });
        setToolBusy(null);
    };

    const runSave = (text: string) => {
        if (!text.trim() || toolBusy || busy) return;
        const art: VaultArtifact = { id: `a_${Date.now()}`, kind: 'note', title: text.slice(0, 42), content: text, createdAt: Date.now() };
        addArtifact(art);
        pushMsg({ role: 'user', content: text, tool: 'save_to_vault', ts: Date.now() });
        setToolResult({ tool: 'vault', action: 'saved', entries: [art], ts: Date.now() });
        pushMsg({ role: 'assistant', content: `Saved to your vault as "${art.title}". Recall it anytime with /recall.`, tool: 'save_to_vault', ts: Date.now() });
    };

    const runRecall = (query: string) => {
        if (toolBusy || busy) return;
        const q = query.trim().toLowerCase();
        const entries = q
            ? vault.artifacts.filter(a => a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q))
            : vault.artifacts.slice(0, 10);
        pushMsg({ role: 'user', content: query || '(all recent)', tool: 'recall', ts: Date.now() });
        setToolResult({ tool: 'vault', action: 'search', entries, query, ts: Date.now() });
        pushMsg({ role: 'assistant', content: entries.length ? `Recalled ${entries.length} vault ${entries.length === 1 ? 'entry' : 'entries'} → canvas.` : `Nothing in the vault matches "${query}" yet.`, tool: 'recall', ts: Date.now() });
    };

    const runToolFromInput = (tool: 'compress' | 'scan' | 'save' | 'recall') => {
        const text = input.trim();
        if (!text) { setRoute(r => ({ ...r, note: 'Type text in the box first, then pick a tool.' })); return; }
        setInput('');
        if (tool === 'compress') runCompress(text);
        else if (tool === 'scan') runScan(text);
        else if (tool === 'save') runSave(text);
        else runRecall(text);
    };

    // --- chat send (with /slash tool routing) --------------------------------
    const send = async () => {
        const raw = input.trim();
        if (!raw || busy || toolBusy) return;

        // slash-command tool routing — deterministic, visible, human-comprehensible
        const slash = raw.match(/^\/(compress|scan|save|recall)\s*([\s\S]*)$/i);
        if (slash) {
            const cmd = slash[1].toLowerCase();
            const arg = slash[2].trim();
            if (cmd !== 'recall' && !arg) { setRoute(r => ({ ...r, note: `/${cmd} needs text after it.` })); return; }
            setInput('');
            if (cmd === 'compress') runCompress(arg);
            else if (cmd === 'scan') runScan(arg);
            else if (cmd === 'save') runSave(arg);
            else runRecall(arg);
            return;
        }

        const userMsg: FMessage = { role: 'user', content: raw, ts: Date.now() };
        const historyForModel = [...(active?.messages || []), userMsg];
        pushMsg(userMsg);
        setInput('');
        setBusy(true);
        setStatus('routing');
        setRoute(r => ({ ...r, note: vault.preferLocal ? 'Reaching for local brain…' : 'Routing to cloud…' }));

        const t0 = performance.now();
        let replyText = '', brain: Brain = 'cloud', fellBack = false;
        try {
            setStatus('thinking');
            if (vault.preferLocal) {
                try { replyText = await callLocal(historyForModel); brain = 'local'; }
                catch { fellBack = true; setRoute(r => ({ ...r, note: 'Local unavailable → falling back to cloud.' })); replyText = await callCloud(historyForModel); brain = 'cloud'; }
            } else { replyText = await callCloud(historyForModel); brain = 'cloud'; }

            const latencyMs = Math.round(performance.now() - t0);
            pushMsg({ role: 'assistant', content: replyText, brain, fellBack, ts: Date.now() });
            setRoute({ brain, fellBack, latencyMs, chars: replyText.length, note: fellBack ? 'Answered by cloud after local fallback.' : brain === 'local' ? 'Answered by local hardware.' : 'Answered by cloud.' });
        } catch (err: any) {
            const latencyMs = Math.round(performance.now() - t0);
            pushMsg({ role: 'assistant', content: `⚠️ Both brains are unreachable right now. ${err?.message || 'Unknown routing error.'}\n\nCheck that the dev server is running, and that GEMINI_API_KEY (cloud) or OLLAMA_ENDPOINT (local) is configured.`, error: true, ts: Date.now() });
            setRoute({ brain: null, fellBack, latencyMs, chars: null, note: 'Routing failed — no brain answered.' });
        } finally { setBusy(false); setStatus('idle'); }
    };

    const statusColor = status === 'idle' ? 'text-emerald-400' : 'text-amber-400';
    const statusLabel = status === 'idle' ? 'Idle' : status === 'routing' ? 'Routing' : 'Thinking';

    const TOOL_CHIPS: { key: 'compress' | 'scan' | 'save' | 'recall'; label: string; icon: React.ReactNode; busyKey: string }[] = [
        { key: 'compress', label: 'Compress', icon: <Scissors size={12} />, busyKey: 'compress' },
        { key: 'scan', label: 'Scan', icon: <Shield size={12} />, busyKey: 'scan_threat' },
        { key: 'save', label: 'Save', icon: <Save size={12} />, busyKey: 'save_to_vault' },
        { key: 'recall', label: 'Recall', icon: <Search size={12} />, busyKey: 'recall' },
    ];

    return (
        <div className="h-full w-full flex flex-col bg-[#0a0e14] text-[#c9d1dc] font-sans select-none overflow-hidden">
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[#232c3a] bg-[#0c1119]">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg grid place-items-center bg-gradient-to-br from-teal-500/20 to-teal-900/10 border border-teal-500/40 text-teal-300"><Cpu size={16} /></div>
                    <div className="leading-tight">
                        <div className="text-[13px] font-bold tracking-wide text-white">FUSION</div>
                        <div className="text-[9px] font-mono tracking-[0.22em] uppercase text-[#74808f]">One Brain · Many Hands</div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center rounded-lg border border-[#232c3a] bg-[#0a0e14] p-0.5 text-[11px] font-mono">
                        <button onClick={() => setPreferLocal(true)} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition ${vault.preferLocal ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40' : 'text-[#74808f] border border-transparent hover:text-[#c9d1dc]'}`} title="Prefer local hardware (Ollama), fall back to cloud"><HardDrive size={12} /> Local</button>
                        <button onClick={() => setPreferLocal(false)} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition ${!vault.preferLocal ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40' : 'text-[#74808f] border border-transparent hover:text-[#c9d1dc]'}`} title="Use cloud (Gemini)"><Cloud size={12} /> Cloud</button>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] font-mono">
                        <Circle size={8} className={`${statusColor} fill-current ${status !== 'idle' ? 'animate-pulse' : ''}`} />
                        <span className={statusColor}>{statusLabel}</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-[200px_1fr_246px] max-[720px]:grid-cols-1 max-[720px]:overflow-y-auto">
                {/* ZONE 1 — MEMORY */}
                <aside className="min-h-0 flex flex-col border-r border-[#232c3a] bg-[#0b0f16] max-[720px]:border-r-0 max-[720px]:border-b">
                    <div className="flex items-center justify-between px-3 py-2 shrink-0">
                        <span className="text-[9px] font-mono tracking-[0.2em] uppercase text-[#74808f]">Memory</span>
                        <button onClick={createSession} className="w-6 h-6 grid place-items-center rounded-md border border-[#232c3a] text-teal-300 hover:bg-teal-500/10 hover:border-teal-500/40 transition" title="New session"><Plus size={13} /></button>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-1 max-[720px]:max-h-40">
                        {vault.conversations.map(c => {
                            const isActive = c.id === vault.activeId;
                            return (
                                <div key={c.id} onClick={() => selectSession(c.id)} className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer border transition ${isActive ? 'bg-teal-500/10 border-teal-500/40 text-white' : 'border-transparent text-[#9aa6b4] hover:bg-[#131a24] hover:border-[#232c3a]'}`}>
                                    <MessageSquare size={12} className={isActive ? 'text-teal-300' : 'text-[#4a5566]'} />
                                    <span className="flex-1 truncate text-[12px]">{c.title || 'New session'}</span>
                                    <button onClick={(e) => { e.stopPropagation(); deleteSession(c.id); }} className="opacity-0 group-hover:opacity-100 text-[#4a5566] hover:text-rose-400 transition" title="Delete session"><Trash2 size={12} /></button>
                                </div>
                            );
                        })}
                    </div>
                    <div className="shrink-0 px-3 py-2 border-t border-[#232c3a] flex items-center gap-1.5 text-[9px] font-mono text-[#4a5566]">
                        <Archive size={10} /> {vault.artifacts.length} vault item{vault.artifacts.length === 1 ? '' : 's'} · {vault.conversations.length} session{vault.conversations.length === 1 ? '' : 's'}
                    </div>
                </aside>

                {/* ZONE 2 — CONVERSATION */}
                <section className="min-h-0 flex flex-col bg-[#0a0e14] max-[720px]:min-h-[60vh]">
                    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
                        {(!active || active.messages.length === 0) && (
                            <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-6">
                                <div className="w-12 h-12 rounded-2xl grid place-items-center bg-teal-500/10 border border-teal-500/30 text-teal-300"><Zap size={22} /></div>
                                <div className="text-[15px] font-semibold text-white">Talk to the machine.</div>
                                <p className="text-[12px] text-[#74808f] max-w-xs leading-relaxed">One mind for the whole OS. Ask anything, or reach for a tool below — <span className="text-teal-300">Compress</span>, <span className="text-teal-300">Scan</span>, <span className="text-teal-300">Save</span>, <span className="text-teal-300">Recall</span>. Results land in the canvas.</p>
                            </div>
                        )}

                        {active?.messages.map((m, i) => (
                            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed border ${m.role === 'user' ? 'bg-teal-500/10 border-teal-500/30 text-teal-50' : m.error ? 'bg-rose-950/30 border-rose-800/50 text-rose-200' : 'bg-[#111721] border-[#232c3a] text-[#c9d1dc]'}`}>
                                    {m.tool && (
                                        <div className="flex items-center gap-1.5 mb-1 text-[9px] font-mono uppercase tracking-wider text-teal-400/80"><Wrench size={9} /> {m.tool}</div>
                                    )}
                                    {m.role === 'assistant' && !m.error && !m.tool && (
                                        <div className="flex items-center gap-1.5 mb-1 text-[9px] font-mono uppercase tracking-wider text-[#74808f]">
                                            {m.brain === 'local' ? <HardDrive size={9} className="text-emerald-400" /> : <Cloud size={9} className="text-amber-400" />}
                                            <span>{m.brain === 'local' ? 'Local' : 'Cloud'}</span>
                                            {m.fellBack && <span className="text-amber-500/80">· fallback</span>}
                                        </div>
                                    )}
                                    <div className="whitespace-pre-wrap">{m.content}</div>
                                </div>
                            </div>
                        ))}

                        {(busy || toolBusy) && (
                            <div className="flex justify-start">
                                <div className="rounded-2xl px-4 py-2.5 bg-[#111721] border border-[#232c3a] text-[12px] text-teal-300 flex items-center gap-2">
                                    <Loader2 size={13} className="animate-spin" />
                                    <span className="font-mono">{toolBusy ? `Running ${toolBusy}…` : route.note}</span>
                                </div>
                            </div>
                        )}
                        <div ref={endRef} />
                    </div>

                    {/* tool chips */}
                    <div className="shrink-0 px-3 pt-2 flex flex-wrap gap-1.5 border-t border-[#232c3a] bg-[#0c1119]">
                        {TOOL_CHIPS.map(t => (
                            <button key={t.key} onClick={() => runToolFromInput(t.key)} disabled={!!toolBusy || busy}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border transition disabled:opacity-40 ${toolBusy === t.busyKey ? 'bg-teal-500/20 border-teal-500/50 text-teal-200' : 'bg-[#0a0e14] border-[#232c3a] text-[#9aa6b4] hover:border-teal-500/40 hover:text-teal-300'}`}
                                title={`Run ${t.key} on the text in the box`}>
                                {toolBusy === t.busyKey ? <Loader2 size={12} className="animate-spin" /> : t.icon}{t.label}
                            </button>
                        ))}
                    </div>

                    {/* input */}
                    <div className="shrink-0 p-3 pt-2 flex items-end gap-2 bg-[#0c1119]">
                        <textarea value={input} onChange={e => setInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                            rows={1} placeholder="Ask the machine…  or /compress /scan /save /recall  (Enter to send)"
                            disabled={busy}
                            className="flex-1 resize-none bg-[#0a0e14] border border-[#232c3a] focus:border-teal-500/50 rounded-xl px-3.5 py-2.5 text-[13px] text-[#e6ebf1] placeholder-[#4a5566] outline-none transition-colors max-h-32" />
                        <button onClick={send} disabled={busy || !!toolBusy || !input.trim()} className="shrink-0 h-[42px] w-[42px] grid place-items-center rounded-xl bg-teal-500 hover:bg-teal-400 disabled:bg-[#1a2129] disabled:text-[#4a5566] text-[#04231f] transition" title="Send">
                            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        </button>
                    </div>
                </section>

                {/* ZONE 3 — LIVE CANVAS */}
                <aside className="min-h-0 flex flex-col border-l border-[#232c3a] bg-[#0b0f16] overflow-y-auto max-[720px]:border-l-0 max-[720px]:border-t">
                    <div className="px-3 py-2 shrink-0"><span className="text-[9px] font-mono tracking-[0.2em] uppercase text-[#74808f]">Live Canvas</span></div>
                    <div className="px-3 pb-3 space-y-3">
                        {/* tool result */}
                        {toolResult && <ToolResultCard result={toolResult} />}

                        {/* active route */}
                        <div className={`rounded-xl border p-3 ${vault.preferLocal ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
                            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider mb-1.5">
                                {vault.preferLocal ? <HardDrive size={11} className="text-emerald-400" /> : <Cloud size={11} className="text-amber-400" />}
                                <span className={vault.preferLocal ? 'text-emerald-300' : 'text-amber-300'}>{vault.preferLocal ? 'Primary · Local' : 'Primary · Cloud'}</span>
                            </div>
                            <div className="text-[12px] text-white font-medium">{vault.preferLocal ? vault.ollamaModel : MODEL_NAME}</div>
                            <div className="text-[10px] font-mono text-[#74808f] mt-0.5 truncate">{vault.preferLocal ? vault.ollamaEndpoint : '/api/gemini/generate'}</div>
                            {vault.preferLocal && <div className="text-[9px] font-mono text-[#4a5566] mt-1.5 flex items-center gap-1"><RefreshCw size={9} /> auto-fallback → cloud</div>}
                        </div>

                        {/* last exchange telemetry */}
                        <div className="rounded-xl border border-[#232c3a] bg-[#0a0e14] p-3">
                            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-[#74808f] mb-2"><Activity size={11} className="text-teal-300" /> Last exchange</div>
                            <div className="space-y-1.5 text-[11px] font-mono">
                                <Telemetry label="Answered by" value={route.brain ? (route.brain === 'local' ? 'Local' : 'Cloud') : '—'} />
                                <Telemetry label="Latency" value={route.latencyMs != null ? `${route.latencyMs} ms` : '—'} />
                                <Telemetry label="Response" value={route.chars != null ? `${route.chars} chars` : '—'} />
                                <Telemetry label="Fallback" value={route.fellBack ? 'yes' : 'no'} valueClass={route.fellBack ? 'text-amber-400' : 'text-[#c9d1dc]'} />
                            </div>
                            <div className="mt-2 pt-2 border-t border-[#1a212d] text-[10px] text-[#74808f] leading-snug">{route.note}</div>
                        </div>

                        {/* tool bus — active */}
                        <div className="rounded-xl border border-[#232c3a] bg-[#0a0e14] p-3">
                            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-[#74808f] mb-2"><Wrench size={11} className="text-teal-300" /> Tool bus <span className="ml-auto text-[8px] text-emerald-400">● live</span></div>
                            <div className="space-y-1">
                                {[{ n: 'compress', l: 'JackyV3' }, { n: 'scan_threat', l: 'JackyV3' }, { n: 'save_to_vault', l: 'Cybernetic67' }, { n: 'recall', l: 'vault' }].map(t => (
                                    <div key={t.n} className="flex items-center gap-2 py-1">
                                        <ChevronRight size={11} className="text-teal-400" />
                                        <span className="text-[11px] font-mono text-[#c9d1dc]">{t.n}</span>
                                        <span className="ml-auto text-[9px] text-[#4a5566]">{t.l}</span>
                                    </div>
                                ))}
                                {PENDING_NEXT.map(t => (
                                    <div key={t.name} className="flex items-center gap-2 py-1 opacity-45">
                                        <ChevronRight size={11} className="text-[#4a5566]" />
                                        <span className="text-[11px] font-mono text-[#9aa6b4]">{t.name}</span>
                                        <span className="ml-auto text-[9px] text-[#4a5566]">{t.phase}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
};

const ToolResultCard: React.FC<{ result: ToolResult }> = ({ result }) => {
    if (result.tool === 'compress') {
        return (
            <div className="rounded-xl border border-teal-500/30 bg-teal-500/5 p-3">
                <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-teal-300 mb-2"><Scissors size={11} /> Compression · −{result.ratioPct}%</div>
                <div className="text-[9px] font-mono text-[#74808f] mb-1.5" style={{ fontVariantNumeric: 'tabular-nums' }}>{result.inChars.toLocaleString()} → {result.outChars.toLocaleString()} chars</div>
                <div className="text-[11px] leading-relaxed text-[#c9d1dc] whitespace-pre-wrap max-h-56 overflow-y-auto bg-[#0a0e14] rounded-lg border border-[#1a212d] p-2.5 select-text">{result.text}</div>
            </div>
        );
    }
    if (result.tool === 'scan') {
        const color = LEVEL_COLOR[result.level] || '#f0b429';
        return (
            <div className="rounded-xl border p-3" style={{ borderColor: `${color}55`, background: `${color}0f` }}>
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider" style={{ color }}><Shield size={11} /> Threat scan</div>
                    <span className="text-[9px] font-mono" style={{ color, fontVariantNumeric: 'tabular-nums' }}>{result.score}/10</span>
                </div>
                <div className="text-lg font-bold mb-1" style={{ color }}>{result.level}</div>
                <div className="text-[11px] text-[#c9d1dc] leading-snug mb-2">{result.rationale}</div>
                <div className="space-y-1 mb-2">
                    {result.hits.map((h, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-[10px]">
                            <AlertTriangle size={10} className="mt-0.5 shrink-0" style={{ color }} />
                            <span className="text-[#9aa6b4]"><b className="text-[#c9d1dc]">{h.name}</b> — {h.context}</span>
                        </div>
                    ))}
                </div>
                <div className="border-t border-[#1a212d] pt-2 space-y-0.5">
                    <div className="text-[9px] font-mono uppercase tracking-wider text-[#74808f] mb-1">Countermeasures</div>
                    {result.countermeasures.map((c, i) => (<div key={i} className="text-[10px] text-[#c9d1dc]">• {c}</div>))}
                </div>
            </div>
        );
    }
    // vault
    return (
        <div className="rounded-xl border border-teal-500/30 bg-teal-500/5 p-3">
            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-teal-300 mb-2">
                <Archive size={11} /> {result.action === 'saved' ? 'Saved to vault' : `Recall${result.query ? `: “${result.query}”` : ''}`} · {result.entries.length}
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {result.entries.length === 0 && <div className="text-[10px] text-[#74808f]">No matching vault entries.</div>}
                {result.entries.map(a => (
                    <div key={a.id} className="bg-[#0a0e14] rounded-lg border border-[#1a212d] p-2 select-text">
                        <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[8px] font-mono uppercase px-1 py-0.5 rounded border border-[#232c3a] text-[#74808f]">{a.kind}</span>
                            <span className="text-[11px] text-[#c9d1dc] font-medium truncate">{a.title}</span>
                        </div>
                        <div className="text-[10px] text-[#74808f] leading-snug line-clamp-3 whitespace-pre-wrap">{a.content.slice(0, 220)}</div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const Telemetry: React.FC<{ label: string; value: string; valueClass?: string }> = ({ label, value, valueClass }) => (
    <div className="flex items-center justify-between">
        <span className="text-[#74808f]">{label}</span>
        <span className={valueClass || 'text-[#c9d1dc]'} style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
);
