/**
 * UsageBreakdownTable — expandable per-phase usage breakdown.
 *
 * Fetches the usage snapshot from `/v1/runs/get_telemetry` (`kind: usage`) and renders a
 * table with one row per phase + a totals row. Clicking a phase row
 * expands to show per-agent and per-model sub-rows.
 */

import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { useOrgFetch } from '@/lib/org_context';


// ─── Types ───────────────────────────────────────────────────────────

interface AgentUsage {
    agent_name: string;
    agent_kind: string;
    tokens_in: number;
    tokens_out: number;
    duration_ms: number;
    invocations: number;
}

interface ModelUsage {
    provider: string;
    model: string;
    tokens_in: number;
    tokens_out: number;
    llm_calls: number;
    cost_usd?: number | null;
}

interface PhaseUsage {
    phase_name: string;
    tokens_in: number;
    tokens_out: number;
    duration_ms: number;
    invocations: number;
    by_agent: Record<string, AgentUsage>;
    by_model: Record<string, ModelUsage>;
}

interface RunSnapshot {
    total_tokens_in: number;
    total_tokens_out: number;
    total_cost_usd: number;
    total_duration_ms: number;
    total_llm_calls: number;
    total_invocations: number;
    by_phase: Record<string, PhaseUsage>;
    by_model: Record<string, ModelUsage>;
}

interface PhaseSnapshot {
    phase: string;
    usage_snapshot: PhaseUsage | null;
}

interface UsageBreakdownTableProps {
    run_id: string;
}


// ─── Component ───────────────────────────────────────────────────────

export function UsageBreakdownTable({ run_id }: UsageBreakdownTableProps) {
    const auth_fetch = useOrgFetch();
    const [run_snapshot, set_run_snapshot] = useState<RunSnapshot | null>(null);
    const [phase_snapshots, set_phase_snapshots] = useState<PhaseSnapshot[]>([]);
    const [loading, set_loading] = useState(true);
    const [expanded, set_expanded] = useState<Set<string>>(new Set());

    const load = useCallback(async () => {
        set_loading(true);
        try {
            const res = await auth_fetch('/v1/runs/get_telemetry', {
                method: 'POST',
                body: JSON.stringify({ kind: 'usage', run_id }),
            });
            const data = await res.json() as {
                run: RunSnapshot | null;
                phases: PhaseSnapshot[];
            };
            set_run_snapshot(data.run ?? null);
            set_phase_snapshots(data.phases ?? []);
        } catch {
            // Silently fail — strip above already shows summary.
        } finally {
            set_loading(false);
        }
    }, [auth_fetch, run_id]);

    useEffect(() => { void load(); }, [load]);

    if (loading) return null;
    if (!run_snapshot) {
        return (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900">
                No usage data available for this run.
            </div>
        );
    }

    /** Toggle phase row expansion. */
    const toggle = (phase: string) => {
        set_expanded((prev) => {
            const next = new Set(prev);
            if (next.has(phase)) {
                next.delete(phase);
            } else {
                next.add(phase);
            }
            return next;
        });
    };

    // Build ordered phase rows from either run_snapshot.by_phase or phase_snapshots.
    const phase_rows = _build_phase_rows(run_snapshot, phase_snapshots);

    return (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                        <th className="px-4 py-2 w-8" />
                        <th className="px-2 py-2">Phase</th>
                        <th className="px-2 py-2 text-right">Tokens In</th>
                        <th className="px-2 py-2 text-right">Tokens Out</th>
                        <th className="px-2 py-2 text-right">Cost</th>
                        <th className="px-2 py-2 text-right">Duration</th>
                        <th className="px-2 py-2 text-right">Invocations</th>
                    </tr>
                </thead>
                <tbody>
                    {phase_rows.map((row) => (
                        <PhaseRow
                            key={row.phase_name}
                            row={row}
                            is_expanded={expanded.has(row.phase_name)}
                            on_toggle={() => toggle(row.phase_name)}
                        />
                    ))}
                    {/* Totals row */}
                    <tr className="border-t border-slate-200 bg-slate-50 font-semibold dark:border-slate-700 dark:bg-slate-800">
                        <td className="px-4 py-2" />
                        <td className="px-2 py-2 text-slate-700 dark:text-slate-200">Total</td>
                        <td className="px-2 py-2 text-right font-mono text-slate-700 dark:text-slate-200">{format_compact(run_snapshot.total_tokens_in)}</td>
                        <td className="px-2 py-2 text-right font-mono text-slate-700 dark:text-slate-200">{format_compact(run_snapshot.total_tokens_out)}</td>
                        <td className="px-2 py-2 text-right font-mono text-slate-700 dark:text-slate-200">{format_cost(run_snapshot.total_cost_usd)}</td>
                        <td className="px-2 py-2 text-right font-mono text-slate-700 dark:text-slate-200">{format_ms(run_snapshot.total_duration_ms)}</td>
                        <td className="px-2 py-2 text-right font-mono text-slate-700 dark:text-slate-200">{run_snapshot.total_invocations}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
}


// ─── Phase row (expandable) ──────────────────────────────────────────

function PhaseRow({ row, is_expanded, on_toggle }: {
    row: PhaseUsage;
    is_expanded: boolean;
    on_toggle: () => void;
}) {
    const has_detail = Object.keys(row.by_agent).length > 0 || Object.keys(row.by_model).length > 0;
    const phase_cost = _sum_model_costs(row.by_model);

    return (
        <>
            <tr
                onClick={has_detail ? on_toggle : undefined}
                className={`border-b border-slate-100 dark:border-slate-800 ${has_detail ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50' : ''}`}
            >
                <td className="px-4 py-2 text-slate-400">
                    {has_detail ? (
                        is_expanded
                            ? <ChevronDown className="h-3 w-3" />
                            : <ChevronRight className="h-3 w-3" />
                    ) : null}
                </td>
                <td className="px-2 py-2 font-mono font-semibold text-slate-700 dark:text-slate-200">{row.phase_name}</td>
                <td className="px-2 py-2 text-right font-mono text-slate-600 dark:text-slate-300">{format_compact(row.tokens_in)}</td>
                <td className="px-2 py-2 text-right font-mono text-slate-600 dark:text-slate-300">{format_compact(row.tokens_out)}</td>
                <td className="px-2 py-2 text-right font-mono text-slate-600 dark:text-slate-300">{format_cost(phase_cost)}</td>
                <td className="px-2 py-2 text-right font-mono text-slate-600 dark:text-slate-300">{format_ms(row.duration_ms)}</td>
                <td className="px-2 py-2 text-right font-mono text-slate-600 dark:text-slate-300">{row.invocations}</td>
            </tr>
            {is_expanded ? (
                <>
                    {/* Per-agent sub-rows */}
                    {Object.values(row.by_agent).map((agent) => (
                        <tr key={agent.agent_name} className="bg-slate-50/50 dark:bg-slate-800/30">
                            <td className="px-4 py-1" />
                            <td className="px-2 py-1 pl-6 text-slate-500">
                                <span className="mr-1.5 text-[9px] uppercase text-slate-400">{agent.agent_kind}</span>
                                {agent.agent_name}
                            </td>
                            <td className="px-2 py-1 text-right font-mono text-slate-500">{format_compact(agent.tokens_in)}</td>
                            <td className="px-2 py-1 text-right font-mono text-slate-500">{format_compact(agent.tokens_out)}</td>
                            <td className="px-2 py-1 text-right text-slate-400">—</td>
                            <td className="px-2 py-1 text-right font-mono text-slate-500">{format_ms(agent.duration_ms)}</td>
                            <td className="px-2 py-1 text-right font-mono text-slate-500">{agent.invocations}</td>
                        </tr>
                    ))}
                    {/* Per-model sub-rows */}
                    {Object.values(row.by_model).map((model) => (
                        <tr key={`${model.provider}/${model.model}`} className="bg-indigo-50/30 dark:bg-indigo-900/10">
                            <td className="px-4 py-1" />
                            <td className="px-2 py-1 pl-6 font-mono text-[10px] text-indigo-600 dark:text-indigo-400">
                                {model.provider}/{model.model}
                            </td>
                            <td className="px-2 py-1 text-right font-mono text-slate-500">{format_compact(model.tokens_in)}</td>
                            <td className="px-2 py-1 text-right font-mono text-slate-500">{format_compact(model.tokens_out)}</td>
                            <td className="px-2 py-1 text-right font-mono text-slate-500">{format_cost(model.cost_usd)}</td>
                            <td className="px-2 py-1 text-right text-slate-400">—</td>
                            <td className="px-2 py-1 text-right font-mono text-slate-500">{model.llm_calls}</td>
                        </tr>
                    ))}
                </>
            ) : null}
        </>
    );
}


// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Build phase rows from the run snapshot. Prefers `by_phase` from the
 * run-level snapshot, falls back to individual phase snapshots.
 */
function _build_phase_rows(
    run_snapshot: RunSnapshot,
    phase_snapshots: PhaseSnapshot[],
): PhaseUsage[] {
    // Run-level snapshot has the full by_phase breakdown.
    if (run_snapshot.by_phase && Object.keys(run_snapshot.by_phase).length > 0) {
        return Object.values(run_snapshot.by_phase) as PhaseUsage[];
    }

    // Fall back to individual phase snapshots.
    return phase_snapshots
        .filter((p) => p.usage_snapshot !== null)
        .map((p) => p.usage_snapshot!);
}

/** Sum cost_usd across all models in a phase. */
function _sum_model_costs(by_model: Record<string, ModelUsage>): number | null {
    let total = 0;
    let has_any = false;
    for (const m of Object.values(by_model)) {
        if (m.cost_usd != null) {
            total += m.cost_usd;
            has_any = true;
        }
    }
    return has_any ? total : null;
}

function format_compact(n: number): string {
    if (!Number.isFinite(n) || n === 0) return '0';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

function format_cost(usd: number | null | undefined): string {
    if (usd == null || !Number.isFinite(usd)) return '—';
    if (usd === 0) return '$0.00';
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
}

function format_ms(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60_000);
    const secs = Math.floor((ms % 60_000) / 1000);
    return `${mins}m ${secs}s`;
}
