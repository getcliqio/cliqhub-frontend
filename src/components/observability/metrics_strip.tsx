/**
 * MetricsStrip — compact top bar of headline usage numbers.
 *
 * Seeds from the durable usage snapshot (initial fetch). For active
 * runs, increments from streaming events and displays a live timer.
 */

import { useState, useEffect, useRef } from 'react';
import { Clock, Zap, DollarSign, Layers, AlertCircle } from 'lucide-react';

import type { StreamEvent } from '@/hooks/use_run_event_stream';


// ─── Types ───────────────────────────────────────────────────────────

interface UsageSnapshot {
    total_tokens_in: number;
    total_tokens_out: number;
    total_cost_usd: number;
    total_duration_ms: number;
    total_llm_calls: number;
    total_invocations: number;
    by_phase?: Record<string, unknown>;
    by_agent?: Record<string, unknown>;
    by_model?: Record<string, unknown>;
}

interface RunMeta {
    started_at: number | null;
    completed_at: number | null;
    state: string;
}

interface MetricsStripProps {
    usage: UsageSnapshot | null;
    run: RunMeta;
    events: StreamEvent[];
    is_live: boolean;
}


// ─── Helpers ─────────────────────────────────────────────────────────

function format_duration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const rem_secs = secs % 60;
    if (mins < 60) return `${mins}m ${rem_secs}s`;
    const hours = Math.floor(mins / 60);
    const rem_mins = mins % 60;
    return `${hours}h ${rem_mins}m`;
}

function format_tokens(n: number): string {
    if (n < 1000) return String(n);
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
    return `${(n / 1_000_000).toFixed(2)}M`;
}

function format_cost(usd: number): string {
    if (usd === 0) return '$0.00';
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
}


// ─── Component ───────────────────────────────────────────────────────

export function MetricsStrip({ usage, run, events, is_live }: MetricsStripProps) {
    // Live timer for active runs.
    const [elapsed_ms, set_elapsed_ms] = useState(0);
    const timer_ref = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (!is_live || !run.started_at) {
            if (timer_ref.current) clearInterval(timer_ref.current);
            // Set final duration for terminal runs.
            if (run.started_at && run.completed_at) {
                set_elapsed_ms(run.completed_at - run.started_at);
            }
            return;
        }

        /** Tick the timer every second. */
        const tick = () => set_elapsed_ms(Date.now() - (run.started_at ?? Date.now()));
        tick();
        timer_ref.current = setInterval(tick, 1000);
        return () => {
            if (timer_ref.current) clearInterval(timer_ref.current);
        };
    }, [is_live, run.started_at, run.completed_at]);

    // Count phase/error events for quick indicators.
    const error_count = events.filter(
        (e) => e.event_type === 'phase_failed' || e.event_type === 'error',
    ).length;

    const phases_completed = events.filter(
        (e) => e.event_type === 'phase_completed',
    ).length;

    const tokens_in = usage?.total_tokens_in ?? 0;
    const tokens_out = usage?.total_tokens_out ?? 0;
    const cost_usd = usage?.total_cost_usd ?? 0;
    const llm_calls = usage?.total_llm_calls ?? 0;
    const duration = is_live
        ? elapsed_ms
        : (usage?.total_duration_ms ?? (run.completed_at && run.started_at ? run.completed_at - run.started_at : 0));

    return (
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs dark:border-slate-700 dark:bg-slate-800">
            <Metric icon={<Clock className="h-3.5 w-3.5" />} label="Duration" value={format_duration(duration)} pulse={is_live} />
            <Metric icon={<Zap className="h-3.5 w-3.5" />} label="Tokens" value={`${format_tokens(tokens_in)} in / ${format_tokens(tokens_out)} out`} />
            <Metric icon={<DollarSign className="h-3.5 w-3.5" />} label="Cost" value={format_cost(cost_usd)} />
            <Metric icon={<Layers className="h-3.5 w-3.5" />} label="LLM Calls" value={String(llm_calls)} />
            <Metric icon={<Layers className="h-3.5 w-3.5" />} label="Phases" value={`${phases_completed} done`} />
            {error_count > 0 && (
                <Metric icon={<AlertCircle className="h-3.5 w-3.5 text-rose-500" />} label="Errors" value={String(error_count)} highlight />
            )}
        </div>
    );
}


// ─── Metric pill ─────────────────────────────────────────────────────

function Metric({ icon, label, value, pulse, highlight }: {
    icon: React.ReactNode;
    label: string;
    value: string;
    pulse?: boolean;
    highlight?: boolean;
}) {
    return (
        <div className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${highlight ? 'bg-rose-50 dark:bg-rose-900/30' : ''}`}>
            <span className={`text-slate-400 dark:text-slate-500 ${pulse ? 'animate-pulse' : ''}`}>{icon}</span>
            <span className="text-slate-500 dark:text-slate-400">{label}</span>
            <span className={`font-mono font-semibold ${highlight ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}`}>
                {value}
            </span>
        </div>
    );
}
