import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Cpu, Send, Plus, Trash2, Cloud, HardDrive, Loader2, Zap, Activity,
    MessageSquare, ChevronRight, RefreshCw, Wrench, Circle
} from 'lucide-react';
import { getAiClient, MODEL_NAME } from '../../lib/gemini';

/**
 * FUSION — Phase 1
 * "One brain, many hands." A single conversational surface that routes to a
 * local brain (Ollama hardware) first and falls back to the cloud (Gemini)
 * automatically. Three calm zones: Memory · Conversation · Live Canvas.
 *
 * Phase 1 ships: the shell, one real routed chat, and a unified vault
 * (localStorage). The tool bus (compress / scan / vault / telegram / task)
 * lands in Phase 2 — its slots are visible here, deliberately marked pending.
 */

type Brain = 'local' | 'cloud';

interface FMessage {
    role: 'user' | 'assistant';
    content: string;
    brain?: Brain;
    fellBack?: boolean;
    error?: boolean;
    ts: number;
}

interface FConversation {
    id: string;
    title: string;
    messages: FMessage[];
    createdAt: number;
}

interface FVault {
    version: 1;
    conversations: FConversation[];
    activeId: string | null;
    preferLocal: boolean;
    ollamaEndpoint: string;
    ollamaModel: string;
}

const VAULT_KEY = 'fusion_vault_v1';

const SYSTEM_PROMPT = `You are the unified intelligence of a local-first developer OS — one mind speaking for the whole machine. You are direct, warm, and technically deep with zero fluff. Lead with the answer; add depth only when it earns its place, so a human is never overwhelmed. You are offline-first and privacy-respecting. When a request would be better served by a real tool — compressing text, scanning a message for threats, saving something to the vault, sending a Telegram message, or running a background task — name the tool you'd reach for; those hands are being wired onto your bus. Keep the human oriented at all times.`;

const PENDING_TOOLS = [
    { name: 'compress', desc: '5–10× semantic squeeze', lineage: 'JackyV3' },
    { name: 'scan_threat', desc: 'phishing / scam audit', lineage: 'JackyV3' },
    { name: 'save_to_vault', desc: 'persist & recall', lineage: 'Cybernetic67' },
    { name: 'send_telegram', desc: 'push to your chat', lineage: 'server.ts' },
    { name: 'run_task', desc: 'background job', lineage: 'SuperSayen' },
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
        version: 1,
        conversations: [c],
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
        const parsed = JSON.parse(raw) as FVault;
        if (!parsed.conversations || parsed.conversations.length === 0) return defaultVault();
        return { ...defaultVault(), ...parsed };
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

export const FusionApp: React.FC = () => {
    const [vault, setVault] = useState<FVault>(loadVault);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<'idle' | 'routing' | 'thinking'>('idle');
    const [route, setRoute] = useState<RouteInfo>({ brain: null, fellBack: false, latencyMs: null, chars: null, note: 'Awaiting first transmission.' });

    const endRef = useRef<HTMLDivElement | null>(null);

    // Persist the whole vault on every change — this is the seed of the unified memory.
    useEffect(() => {
        try {
            localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
        } catch (e) {
            console.warn('Fusion vault save failed:', e);
        }
    }, [vault]);

    const active = vault.conversations.find(c => c.id === vault.activeId) || vault.conversations[0];

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [active?.messages.length, busy]);

    // --- vault mutations -----------------------------------------------------
    const patchActive = useCallback((mut: (c: FConversation) => FConversation) => {
        setVault(v => ({
            ...v,
            conversations: v.conversations.map(c => (c.id === v.activeId ? mut(c) : c)),
        }));
    }, []);

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
            const activeId = v.activeId === id ? remaining[0].id : v.activeId;
            return { ...v, conversations: remaining, activeId };
        });
    };

    const setPreferLocal = (preferLocal: boolean) => setVault(v => ({ ...v, preferLocal }));

    // --- model routing -------------------------------------------------------
    const callCloud = async (history: FMessage[]): Promise<string> => {
        const ai = getAiClient();
        const contents =
            `${SYSTEM_PROMPT}\n\n` +
            history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') +
            `\nAssistant:`;
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents,
            config: { temperature: 0.7 },
        });
        const text = (response.text || '').trim();
        if (!text) throw new Error('Empty cloud response');
        return text;
    };

    const callLocal = async (history: FMessage[]): Promise<string> => {
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history.map(m => ({ role: m.role, content: m.content })),
        ];
        const res = await fetch('/api/ollama/real', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages,
                customEndpoint: vault.ollamaEndpoint,
                model: vault.ollamaModel,
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.response) {
            throw new Error(data.error || `Local brain unreachable (${res.status})`);
        }
        return String(data.response).trim();
    };

    const send = async () => {
        const text = input.trim();
        if (!text || busy) return;

        const userMsg: FMessage = { role: 'user', content: text, ts: Date.now() };
        const historyForModel = [...(active?.messages || []), userMsg];

        // append user message + title the session from its first line
        patchActive(c => ({
            ...c,
            title: c.messages.length === 0 ? text.slice(0, 42) : c.title,
            messages: [...c.messages, userMsg],
        }));
        setInput('');
        setBusy(true);
        setStatus('routing');
        setRoute(r => ({ ...r, note: vault.preferLocal ? 'Reaching for local brain…' : 'Routing to cloud…' }));

        const t0 = performance.now();
        let replyText = '';
        let brain: Brain = 'cloud';
        let fellBack = false;

        try {
            setStatus('thinking');
            if (vault.preferLocal) {
                try {
                    replyText = await callLocal(historyForModel);
                    brain = 'local';
                } catch (localErr) {
                    fellBack = true;
                    setRoute(r => ({ ...r, note: 'Local unavailable → falling back to cloud.' }));
                    replyText = await callCloud(historyForModel);
                    brain = 'cloud';
                }
            } else {
                replyText = await callCloud(historyForModel);
                brain = 'cloud';
            }

            const latencyMs = Math.round(performance.now() - t0);
            const assistantMsg: FMessage = { role: 'assistant', content: replyText, brain, fellBack, ts: Date.now() };
            patchActive(c => ({ ...c, messages: [...c.messages, assistantMsg] }));
            setRoute({
                brain,
                fellBack,
                latencyMs,
                chars: replyText.length,
                note: fellBack
                    ? 'Answered by cloud after local fallback.'
                    : brain === 'local'
                        ? 'Answered by local hardware.'
                        : 'Answered by cloud.',
            });
        } catch (err: any) {
            const latencyMs = Math.round(performance.now() - t0);
            const msg = `⚠️ Both brains are unreachable right now. ${err?.message || 'Unknown routing error.'}\n\nCheck that the dev server is running, and that GEMINI_API_KEY (cloud) or OLLAMA_ENDPOINT (local) is configured.`;
            patchActive(c => ({ ...c, messages: [...c.messages, { role: 'assistant', content: msg, error: true, ts: Date.now() }] }));
            setRoute({ brain: null, fellBack, latencyMs, chars: null, note: 'Routing failed — no brain answered.' });
        } finally {
            setBusy(false);
            setStatus('idle');
        }
    };

    const statusColor = status === 'idle' ? 'text-emerald-400' : 'text-amber-400';
    const statusLabel = status === 'idle' ? 'Idle' : status === 'routing' ? 'Routing' : 'Thinking';

    return (
        <div className="h-full w-full flex flex-col bg-[#0a0e14] text-[#c9d1dc] font-sans select-none overflow-hidden">
            {/* ---- Header : brand + model route toggle + live status ---- */}
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[#232c3a] bg-[#0c1119]">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg grid place-items-center bg-gradient-to-br from-teal-500/20 to-teal-900/10 border border-teal-500/40 text-teal-300">
                        <Cpu size={16} />
                    </div>
                    <div className="leading-tight">
                        <div className="text-[13px] font-bold tracking-wide text-white">FUSION</div>
                        <div className="text-[9px] font-mono tracking-[0.22em] uppercase text-[#74808f]">One Brain · Many Hands</div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* route toggle */}
                    <div className="flex items-center rounded-lg border border-[#232c3a] bg-[#0a0e14] p-0.5 text-[11px] font-mono">
                        <button
                            onClick={() => setPreferLocal(true)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition ${vault.preferLocal ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40' : 'text-[#74808f] border border-transparent hover:text-[#c9d1dc]'}`}
                            title="Prefer local hardware (Ollama), fall back to cloud"
                        >
                            <HardDrive size={12} /> Local
                        </button>
                        <button
                            onClick={() => setPreferLocal(false)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition ${!vault.preferLocal ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40' : 'text-[#74808f] border border-transparent hover:text-[#c9d1dc]'}`}
                            title="Use cloud (Gemini)"
                        >
                            <Cloud size={12} /> Cloud
                        </button>
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] font-mono">
                        <Circle size={8} className={`${statusColor} fill-current ${status !== 'idle' ? 'animate-pulse' : ''}`} />
                        <span className={statusColor}>{statusLabel}</span>
                    </div>
                </div>
            </div>

            {/* ---- Three zones ---- */}
            <div className="flex-1 min-h-0 grid grid-cols-[200px_1fr_230px] max-[720px]:grid-cols-1 max-[720px]:overflow-y-auto">

                {/* ZONE 1 — MEMORY */}
                <aside className="min-h-0 flex flex-col border-r border-[#232c3a] bg-[#0b0f16] max-[720px]:border-r-0 max-[720px]:border-b">
                    <div className="flex items-center justify-between px-3 py-2 shrink-0">
                        <span className="text-[9px] font-mono tracking-[0.2em] uppercase text-[#74808f]">Memory</span>
                        <button
                            onClick={createSession}
                            className="w-6 h-6 grid place-items-center rounded-md border border-[#232c3a] text-teal-300 hover:bg-teal-500/10 hover:border-teal-500/40 transition"
                            title="New session"
                        >
                            <Plus size={13} />
                        </button>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-1 max-[720px]:max-h-40">
                        {vault.conversations.map(c => {
                            const isActive = c.id === vault.activeId;
                            return (
                                <div
                                    key={c.id}
                                    onClick={() => selectSession(c.id)}
                                    className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer border transition ${isActive ? 'bg-teal-500/10 border-teal-500/40 text-white' : 'border-transparent text-[#9aa6b4] hover:bg-[#131a24] hover:border-[#232c3a]'}`}
                                >
                                    <MessageSquare size={12} className={isActive ? 'text-teal-300' : 'text-[#4a5566]'} />
                                    <span className="flex-1 truncate text-[12px]">{c.title || 'New session'}</span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); deleteSession(c.id); }}
                                        className="opacity-0 group-hover:opacity-100 text-[#4a5566] hover:text-rose-400 transition"
                                        title="Delete session"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    <div className="shrink-0 px-3 py-2 border-t border-[#232c3a] text-[9px] font-mono text-[#4a5566]">
                        {vault.conversations.length} session{vault.conversations.length === 1 ? '' : 's'} · local vault
                    </div>
                </aside>

                {/* ZONE 2 — CONVERSATION */}
                <section className="min-h-0 flex flex-col bg-[#0a0e14] max-[720px]:min-h-[60vh]">
                    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
                        {(!active || active.messages.length === 0) && (
                            <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-6">
                                <div className="w-12 h-12 rounded-2xl grid place-items-center bg-teal-500/10 border border-teal-500/30 text-teal-300">
                                    <Zap size={22} />
                                </div>
                                <div className="text-[15px] font-semibold text-white">Talk to the machine.</div>
                                <p className="text-[12px] text-[#74808f] max-w-xs leading-relaxed">
                                    One mind for the whole OS. It routes to your {vault.preferLocal ? 'local hardware first' : 'cloud'} and answers in one voice. Tools land next — for now, just ask.
                                </p>
                            </div>
                        )}

                        {active?.messages.map((m, i) => (
                            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div
                                    className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed border ${
                                        m.role === 'user'
                                            ? 'bg-teal-500/10 border-teal-500/30 text-teal-50'
                                            : m.error
                                                ? 'bg-rose-950/30 border-rose-800/50 text-rose-200'
                                                : 'bg-[#111721] border-[#232c3a] text-[#c9d1dc]'
                                    }`}
                                >
                                    {m.role === 'assistant' && !m.error && (
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

                        {busy && (
                            <div className="flex justify-start">
                                <div className="rounded-2xl px-4 py-2.5 bg-[#111721] border border-[#232c3a] text-[12px] text-teal-300 flex items-center gap-2">
                                    <Loader2 size={13} className="animate-spin" />
                                    <span className="font-mono">{route.note}</span>
                                </div>
                            </div>
                        )}
                        <div ref={endRef} />
                    </div>

                    {/* input */}
                    <div className="shrink-0 border-t border-[#232c3a] p-3 flex items-end gap-2 bg-[#0c1119]">
                        <textarea
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                            }}
                            rows={1}
                            placeholder="Ask the machine…  (Enter to send · Shift+Enter for newline)"
                            disabled={busy}
                            className="flex-1 resize-none bg-[#0a0e14] border border-[#232c3a] focus:border-teal-500/50 rounded-xl px-3.5 py-2.5 text-[13px] text-[#e6ebf1] placeholder-[#4a5566] outline-none transition-colors max-h-32"
                        />
                        <button
                            onClick={send}
                            disabled={busy || !input.trim()}
                            className="shrink-0 h-[42px] w-[42px] grid place-items-center rounded-xl bg-teal-500 hover:bg-teal-400 disabled:bg-[#1a2129] disabled:text-[#4a5566] text-[#04231f] transition"
                            title="Send"
                        >
                            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        </button>
                    </div>
                </section>

                {/* ZONE 3 — LIVE CANVAS */}
                <aside className="min-h-0 flex flex-col border-l border-[#232c3a] bg-[#0b0f16] overflow-y-auto max-[720px]:border-l-0 max-[720px]:border-t">
                    <div className="px-3 py-2 shrink-0">
                        <span className="text-[9px] font-mono tracking-[0.2em] uppercase text-[#74808f]">Live Canvas</span>
                    </div>

                    <div className="px-3 pb-3 space-y-3">
                        {/* active route */}
                        <div className={`rounded-xl border p-3 ${vault.preferLocal ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
                            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider mb-1.5">
                                {vault.preferLocal ? <HardDrive size={11} className="text-emerald-400" /> : <Cloud size={11} className="text-amber-400" />}
                                <span className={vault.preferLocal ? 'text-emerald-300' : 'text-amber-300'}>
                                    {vault.preferLocal ? 'Primary · Local' : 'Primary · Cloud'}
                                </span>
                            </div>
                            <div className="text-[12px] text-white font-medium">
                                {vault.preferLocal ? vault.ollamaModel : MODEL_NAME}
                            </div>
                            <div className="text-[10px] font-mono text-[#74808f] mt-0.5 truncate">
                                {vault.preferLocal ? vault.ollamaEndpoint : '/api/gemini/generate'}
                            </div>
                            {vault.preferLocal && (
                                <div className="text-[9px] font-mono text-[#4a5566] mt-1.5 flex items-center gap-1">
                                    <RefreshCw size={9} /> auto-fallback → cloud
                                </div>
                            )}
                        </div>

                        {/* last exchange telemetry */}
                        <div className="rounded-xl border border-[#232c3a] bg-[#0a0e14] p-3">
                            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-[#74808f] mb-2">
                                <Activity size={11} className="text-teal-300" /> Last exchange
                            </div>
                            <div className="space-y-1.5 text-[11px] font-mono">
                                <Telemetry label="Answered by" value={route.brain ? (route.brain === 'local' ? 'Local' : 'Cloud') : '—'} />
                                <Telemetry label="Latency" value={route.latencyMs != null ? `${route.latencyMs} ms` : '—'} />
                                <Telemetry label="Response" value={route.chars != null ? `${route.chars} chars` : '—'} />
                                <Telemetry label="Fallback" value={route.fellBack ? 'yes' : 'no'} valueClass={route.fellBack ? 'text-amber-400' : 'text-[#c9d1dc]'} />
                            </div>
                            <div className="mt-2 pt-2 border-t border-[#1a212d] text-[10px] text-[#74808f] leading-snug">
                                {route.note}
                            </div>
                        </div>

                        {/* tool bus — pending (Phase 2) */}
                        <div className="rounded-xl border border-[#232c3a] bg-[#0a0e14] p-3">
                            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-[#74808f] mb-2">
                                <Wrench size={11} className="text-teal-300" /> Tool bus
                                <span className="ml-auto text-[8px] text-[#4a5566]">Phase 2</span>
                            </div>
                            <div className="space-y-1">
                                {PENDING_TOOLS.map(t => (
                                    <div key={t.name} className="flex items-center gap-2 py-1 opacity-55">
                                        <ChevronRight size={11} className="text-[#4a5566]" />
                                        <span className="text-[11px] font-mono text-[#9aa6b4]">{t.name}</span>
                                        <span className="ml-auto text-[9px] text-[#4a5566]">{t.lineage}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-2 text-[9px] text-[#4a5566] leading-snug">
                                Hands wire onto the bus next — results will render here.
                            </div>
                        </div>
                    </div>
                </aside>
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
