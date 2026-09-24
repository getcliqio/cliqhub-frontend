/**
 * EventCard — renders a single streaming event in the activity stream.
 *
 * Dispatches to type-specific sub-renderers based on `event_type`.
 * Each card has a timestamp, phase tag, and type-appropriate content.
 */

import { useState, memo } from 'react';
import {
    MessageSquare, Wrench, Brain, ShieldCheck, ShieldAlert,
    Play, CheckCircle, XCircle, AlertTriangle, Pause, ChevronDown, ChevronRight,
} from 'lucide-react';

import type { StreamEvent } from '@/hooks/use_run_event_stream';


// ─── Component ───────────────────────────────────────────────────────

function EventCardComponent({ event }: { event: StreamEvent }) {
    const renderer = RENDERERS[event.event_type] ?? default_renderer;
    return renderer(event);
}

export const EventCard = memo(EventCardComponent);


// ─── Shared card shell ───────────────────────────────────────────────

function CardShell({ event, icon, accent, children }: {
    event: StreamEvent;
    icon: React.ReactNode;
    accent?: string;
    children: React.ReactNode;
}) {
    // `event.timestamp` arrives from the Hub as a BIGINT — Sequelize
    // returns it as a decimal string (e.g. "1788784801782"). Passing a
    // numeric string to `new Date()` yields "Invalid Date" (JS only
    // accepts ISO-formatted strings or numbers). Coerce first.
    const ts_num = typeof event.timestamp === 'number'
        ? event.timestamp
        : Number(event.timestamp);
    const time = Number.isFinite(ts_num) && ts_num > 0
        ? new Date(ts_num).toLocaleTimeString()
        : '—';

    return (
        <div className={`mb-2 rounded-lg border ${accent ?? 'border-slate-200 dark:border-slate-700'} bg-white p-3 dark:bg-slate-900`}>
            <div className="mb-1 flex items-center gap-2 text-[10px] text-slate-400">
                {icon}
                <span className="font-mono">{time}</span>
                {event.phase && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono dark:bg-slate-800">
                        {event.phase}
                    </span>
                )}
                {event.agent && (
                    <span className="text-slate-500">{event.agent}</span>
                )}
            </div>
            {children}
        </div>
    );
}


// ─── Collapsible wrapper ─────────────────────────────────────────────

function Collapsible({ label, children, default_open = false }: {
    label: string;
    children: React.ReactNode;
    default_open?: boolean;
}) {
    const [open, set_open] = useState(default_open);
    return (
        <div>
            <button
                onClick={() => set_open(!open)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {label}
            </button>
            {open && <div className="mt-1">{children}</div>}
        </div>
    );
}


// ─── Type-specific renderers ─────────────────────────────────────────

type Renderer = (event: StreamEvent) => React.JSX.Element;

const RENDERERS: Record<string, Renderer> = {
    llm_output: (e) => (
        <CardShell event={e} icon={<MessageSquare className="h-3 w-3 text-sky-500" />}>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-300">
                {_payload_text(e.payload)}
            </pre>
            {_model_badge(e.payload)}
        </CardShell>
    ),

    tool_call: (e) => {
        const p = e.payload as Record<string, unknown> | null;
        return (
            <CardShell event={e} icon={<Wrench className="h-3 w-3 text-violet-500" />}>
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    🔧 {(p?.tool_name as string) ?? 'tool call'}
                </div>
                <Collapsible label="Arguments & result">
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-slate-500">
                        {JSON.stringify(p, null, 2)}
                    </pre>
                </Collapsible>
            </CardShell>
        );
    },

    thinking: (e) => (
        <CardShell event={e} icon={<Brain className="h-3 w-3 text-slate-400" />}>
            <div className="italic text-xs text-slate-400 dark:text-slate-500">
                {_payload_text(e.payload) || '(thinking…)'}
            </div>
        </CardShell>
    ),

    gate_decision: (e) => {
        const p = e.payload as Record<string, unknown> | null;
        const verdict = (p?.verdict as string) ?? 'unknown';
        const is_pass = verdict === 'pass' || verdict === 'approve';
        const is_rework = verdict === 'rework' || verdict === 'revise';
        const icon = is_pass
            ? <ShieldCheck className="h-3 w-3 text-emerald-500" />
            : <ShieldAlert className="h-3 w-3 text-amber-500" />;
        const accent = is_pass
            ? 'border-emerald-200 dark:border-emerald-800'
            : is_rework
                ? 'border-amber-200 dark:border-amber-800'
                : 'border-rose-200 dark:border-rose-800';

        return (
            <CardShell event={e} icon={icon} accent={accent}>
                <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${
                        is_pass ? 'bg-emerald-100 text-emerald-700' : is_rework ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
                    }`}>
                        {verdict}
                    </span>
                    {p?.iteration ? (
                        <span className="text-xs text-slate-500">iteration {String(p.iteration)}</span>
                    ) : null}
                </div>
                {p?.reasoning ? (
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{String(p.reasoning)}</p>
                ) : null}
            </CardShell>
        );
    },

    phase_started: (e) => (
        <CardShell event={e} icon={<Play className="h-3 w-3 text-sky-500" />} accent="border-sky-200 dark:border-sky-800">
            <div className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                Phase started: {e.phase}
            </div>
        </CardShell>
    ),

    phase_completed: (e) => (
        <CardShell event={e} icon={<CheckCircle className="h-3 w-3 text-emerald-500" />} accent="border-emerald-200 dark:border-emerald-800">
            <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                Phase completed: {e.phase}
            </div>
        </CardShell>
    ),

    phase_failed: (e) => (
        <CardShell event={e} icon={<XCircle className="h-3 w-3 text-rose-500" />} accent="border-rose-200 dark:border-rose-800">
            <div className="text-xs font-semibold text-rose-700 dark:text-rose-400">
                Phase failed: {e.phase}
            </div>
            {_payload_error(e.payload)}
        </CardShell>
    ),

    phase_awaiting_input: (e) => (
        <CardShell event={e} icon={<Pause className="h-3 w-3 text-purple-500" />} accent="border-purple-200 dark:border-purple-800">
            <div className="text-xs font-semibold text-purple-700 dark:text-purple-400">
                ⏸ Awaiting input: {e.phase}
            </div>
        </CardShell>
    ),

    run_complete: (e) => (
        <CardShell event={e} icon={<CheckCircle className="h-3 w-3 text-emerald-500" />} accent="border-emerald-300 dark:border-emerald-700">
            <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                ✓ Run completed
            </div>
        </CardShell>
    ),

    run_failed: (e) => (
        <CardShell event={e} icon={<XCircle className="h-3 w-3 text-rose-500" />} accent="border-rose-300 dark:border-rose-700">
            <div className="text-sm font-bold text-rose-700 dark:text-rose-400">
                ✕ Run failed
            </div>
            {_payload_error(e.payload)}
        </CardShell>
    ),

    run_crashed: (e) => (
        <CardShell event={e} icon={<AlertTriangle className="h-3 w-3 text-rose-500" />} accent="border-rose-300 dark:border-rose-700">
            <div className="text-sm font-bold text-rose-700 dark:text-rose-400">
                💥 Run crashed
            </div>
            {_payload_error(e.payload)}
        </CardShell>
    ),

    error: (e) => (
        <CardShell event={e} icon={<AlertTriangle className="h-3 w-3 text-rose-500" />} accent="border-rose-200 dark:border-rose-800">
            <div className="text-xs text-rose-600 dark:text-rose-400">
                {_payload_text(e.payload) || 'Unknown error'}
            </div>
            {_payload_stack(e.payload)}
        </CardShell>
    ),
};

// Daemon-side event names (see cliq-platform/daemon/src/core/service/
// run_executor.ts). Aliased to the existing renderers so the wire format
// the daemon actually emits gets a pretty card instead of default_renderer.
RENDERERS['phase_start'] = RENDERERS['phase_started'];
RENDERERS['phase_complete'] = RENDERERS['phase_completed'];
RENDERERS['phase_error'] = RENDERERS['phase_failed'];
RENDERERS['gate_verdict'] = RENDERERS['gate_decision'];
RENDERERS['run_cancelled'] = RENDERERS['run_failed'];

function default_renderer(e: StreamEvent) {
    return (
        <CardShell event={e} icon={<MessageSquare className="h-3 w-3 text-slate-400" />}>
            <div className="text-xs text-slate-600 dark:text-slate-400">
                <span className="font-mono font-semibold">{e.event_type}</span>
            </div>
            {e.payload ? (
                <Collapsible label="Payload">
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-slate-500">
                        {JSON.stringify(e.payload, null, 2)}
                    </pre>
                </Collapsible>
            ) : null}
        </CardShell>
    );
}


// ─── Payload helpers ─────────────────────────────────────────────────

function _payload_text(payload: unknown): string {
    if (!payload) return '';
    if (typeof payload === 'string') return payload;
    const obj = payload as Record<string, unknown>;
    return String(obj.text ?? obj.output ?? obj.message ?? obj.content ?? '');
}

function _payload_error(payload: unknown): React.ReactNode {
    if (!payload) return null;
    const obj = payload as Record<string, unknown>;
    const msg = String(obj.error ?? obj.message ?? '');
    if (!msg) return null;
    return <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{msg}</p>;
}

function _payload_stack(payload: unknown): React.ReactNode {
    if (!payload) return null;
    const obj = payload as Record<string, unknown>;
    const stack = String(obj.stack ?? obj.stacktrace ?? '');
    if (!stack) return null;
    return (
        <Collapsible label="Stack trace">
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-slate-400">{stack}</pre>
        </Collapsible>
    );
}

function _model_badge(payload: unknown): React.ReactNode {
    if (!payload) return null;
    const obj = payload as Record<string, unknown>;
    const model = String(obj.model ?? '');
    if (!model) return null;
    return (
        <div className="mt-1">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 dark:bg-slate-800">
                {model}
            </span>
        </div>
    );
}
