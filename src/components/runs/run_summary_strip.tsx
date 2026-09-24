import { useCallback, useEffect, useState } from 'react';

import { useOrgFetch } from '@/lib/org_context';
import { use_poll } from '@/lib/use_poll';

/**
 * Compact strip of headline usage numbers for a run — reads from the
 * durable usage snapshot delivered via the outbox (Phase 1d).
 *
 * Replaces the previous OTEL root-span approach. Usage snapshots are
 * always available for completed runs (outbox delivery) and update
 * incrementally during active runs (phase completion triggers snapshot).
 */

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

interface Run_summary_strip_props {
    run_id: string;
    /** Poll while the run is still live so the strip animates in place. */
    live?: boolean;
}

export function Run_summary_strip({ run_id, live }: Run_summary_strip_props) {
    const auth_fetch = useOrgFetch();
    const [snapshot, set_snapshot] = useState<UsageSnapshot | null>(null);
    const [loading, set_loading] = useState(true);
    const [error, set_error] = useState<string | null>(null);

    const load = useCallback(async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) set_loading(true);
        try {
            const res = await auth_fetch('/v1/runs/get_telemetry', {
                method: 'POST',
                body: JSON.stringify({ kind: 'usage', run_id }),
            });
            const data = await res.json() as { ok?: boolean; run?: UsageSnapshot; error?: unknown };
            if (data.run) {
                set_snapshot(data.run);
                set_error(null);
            }
        } catch {
            if (!opts?.silent) set_error('Failed to load usage');
        } finally {
            if (!opts?.silent) set_loading(false);
        }
    }, [auth_fetch, run_id]);

    useEffect(() => { void load(); }, [load]);
    use_poll(() => void load({ silent: true }), live ? 5_000 : 60_000, !loading);

    if (loading && !snapshot) return null;

    // No usage data available (pre-feature run or no agents reported).
    if (!snapshot || _is_empty(snapshot)) {
        return (
            <section className="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
                    <span>{live
                        ? 'Collecting usage data…'
                        : 'No usage data recorded for this run.'}</span>
                </div>
                {error ? <p className="mt-1 text-[11px] text-rose-500">{error}</p> : null}
            </section>
        );
    }

    return (
        <section className="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-xs">
                <Metric label="Duration" value={format_ms(snapshot.total_duration_ms)} />
                <Metric label="Cost" value={format_cost(snapshot.total_cost_usd)} />
                <Metric
                    label="Tokens"
                    value={format_tokens(snapshot.total_tokens_in, snapshot.total_tokens_out)}
                />
                <Metric label="LLM calls" value={String(snapshot.total_llm_calls)} />
                <Metric label="Invocations" value={String(snapshot.total_invocations)} />
                {live ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-sky-500">
                        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                        in progress
                    </span>
                ) : null}
            </div>
            {error ? <p className="mt-1 text-[11px] text-rose-500">{error}</p> : null}
        </section>
    );
}


// ─── Sub-components ──────────────────────────────────────────────────

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {label}
            </div>
            <div className="mt-0.5 font-mono text-sm text-slate-800 dark:text-slate-200">
                {value}
            </div>
        </div>
    );
}


// ─── Helpers ─────────────────────────────────────────────────────────

function _is_empty(s: UsageSnapshot): boolean {
    return s.total_invocations === 0
        && s.total_tokens_in === 0
        && s.total_tokens_out === 0
        && s.total_llm_calls === 0;
}

function format_ms(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60_000);
    const secs = Math.floor((ms % 60_000) / 1000);
    return `${mins}m ${secs}s`;
}

function format_cost(usd: number | null | undefined): string {
    if (usd == null || !Number.isFinite(usd)) return '—';
    if (usd === 0) return '$0.00';
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(3)}`;
}

function format_tokens(inn: number, out: number): string {
    if (inn === 0 && out === 0) return '—';
    return `${format_compact(inn)} / ${format_compact(out)}`;
}

function format_compact(n: number): string {
    if (!Number.isFinite(n)) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}
