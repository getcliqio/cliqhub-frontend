import { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useOutletContext } from 'react-router';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { Pagination, PAGE_LIMIT } from '@/components/pagination';
import { Confirm_action } from '@/components/dispatch/confirm_action';
import { Run_team_dialog, Supply_inputs_dialog } from '@/components/dispatch/run_dialogs';
import { use_busy } from '@/lib/use_busy';
import { use_poll } from '@/lib/use_poll';
import { FolderOpen } from 'lucide-react';
import type { Realm_outlet_context } from '@/layouts/realm_layout';
import { hub_payload } from '@/lib/hub_envelope';

interface WorkspaceInfo {
    id: string;
    name: string | null;
    path: string;
    daemon_id: string;
    daemon_hostname: string | null;
    created_at: number | string;
}

interface TeamRow {
    team_id: string;
    scope: string;
    slug: string;
    assembled_at: number | string;
}

interface RunRow {
    run_id: string;
    state: string;
    team_label: string | null;
    started_at: number | null;
    completed_at: number | null;
}

function format_relative(ts: number | null): string {
    if (!ts || ts <= 0) return '—';
    const age_s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (age_s < 60) return `${age_s}s ago`;
    if (age_s < 3600) return `${Math.floor(age_s / 60)}m ago`;
    if (age_s < 86400) return `${Math.floor(age_s / 3600)}h ago`;
    return `${Math.floor(age_s / 86400)}d ago`;
}

function run_state_classes(state: string): string {
    if (state === 'completed') return 'text-emerald-700';
    if (state === 'failed' || state === 'crashed') return 'text-red-600';
    if (state === 'running') return 'text-indigo-600';
    if (state === 'awaiting_input') return 'text-amber-600';
    return 'text-slate-500';
}

function api_err(data: { error?: unknown }, fallback: string): string {
    const err = data.error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
        return (err as { message: string }).message;
    }
    return fallback;
}

export function Component() {
    const { workspace_id } = useParams<{ workspace_id: string }>();
    const { realm, base_path } = useOutletContext<Realm_outlet_context>();
    const auth_fetch = useOrgFetch();

    const [workspace, set_workspace] = useState<WorkspaceInfo | null>(null);
    const [teams, set_teams] = useState<TeamRow[]>([]);
    const [runs, set_runs] = useState<RunRow[]>([]);
    const [runs_total, set_runs_total] = useState(0);
    const [runs_offset, set_runs_offset] = useState(0);
    const [loading, set_loading] = useState(true);
    const [error, set_error] = useState<string | null>(null);
    const [notice, set_notice] = useState<string | null>(null);

    const [show_run, set_show_run] = useState(false);
    const [supply_run_id, set_supply_run_id] = useState<string | null>(null);
    const [cancel_confirm, set_cancel_confirm] = useState<string | null>(null);
    const { is_busy, run_busy } = use_busy();

    const load = useCallback(async () => {
        if (!workspace_id) return;
        set_loading(true);
        try {
            const [ws_res, runs_res] = await Promise.all([
                auth_fetch('/v1/workspaces/get_by_id', {
                    method: 'POST',
                    body: JSON.stringify({ id: workspace_id, workspace_id }),
                }),
                auth_fetch('/v1/runs/get', {
                    method: 'POST',
                    body: JSON.stringify({
                        workspace_id,
                        limit: PAGE_LIMIT,
                        offset: runs_offset,
                    }),
                }),
            ]);

            const ws_data = await ws_res.json();
            if (!ws_data.ok || !ws_data.workspace) {
                set_workspace(null);
                set_error(ws_data.error?.message ?? 'Workspace not found');
                return;
            }
            set_workspace(ws_data.workspace);
            set_teams(Array.isArray(ws_data.teams) ? ws_data.teams : []);

            const runs_data = await runs_res.json();
            if (runs_data.ok) {
                const page = hub_payload<{ items?: RunRow[]; total?: number }>(runs_data);
                const list = Array.isArray(runs_data.data)
                    ? (runs_data.data as RunRow[])
                    : (page?.items ?? []);
                set_runs(list);
                set_runs_total(Number(page?.total ?? list.length));
            }

            set_error(null);
        } catch {
            set_error('Failed to load workspace details');
        } finally {
            set_loading(false);
        }
    }, [auth_fetch, workspace_id, runs_offset]);

    useEffect(() => {
        void load();
    }, [load]);


    const has_active_runs = runs.some((r) => r.state === 'running' || r.state === 'awaiting_input');
    use_poll(() => void load(), has_active_runs ? 3_000 : 10_000, !loading);



    const handle_run = async (team_id: string, inputs?: Record<string, string>) => {
        if (!workspace) return;
        set_notice(null);
        await run_busy('run', async () => {
            try {
                const res = await auth_fetch('/v1/runs/enqueue', {
                    method: 'POST',
                    body: JSON.stringify({
                        workspace_id: workspace.id,
                        team_id,
                        daemon_id: workspace.daemon_id,
                        workspace_path: workspace.path,
                        inputs: inputs && Object.keys(inputs).length > 0 ? inputs : undefined,
                    }),
                });
                const data = await res.json();
                if (!data.ok) {
                    set_error(api_err(data, 'Run failed'));
                    return;
                }
                const enqueue_payload = hub_payload<{ run_id?: string }>(data);
                const run_id = typeof enqueue_payload?.run_id === 'string' ? enqueue_payload.run_id : null;
                set_notice(run_id
                    ? `Run dispatched (${run_id.slice(0, 8)}…). Watch notifications for progress.`
                    : 'Run dispatched. Watch notifications for progress.');
                set_show_run(false);
                void load();
            } catch {
                set_error('Run request failed');
            }
        });
    };

    const handle_supply_inputs = async (run_id: string, inputs: Record<string, string>) => {
        set_notice(null);
        await run_busy(`supply:${run_id}`, async () => {
            try {
                const res = await auth_fetch('/v1/runs/supply_inputs', {
                    method: 'POST',
                    body: JSON.stringify({ run_id, inputs }),
                });
                const data = await res.json();
                if (!data.ok) {
                    set_error(api_err(data, 'Supply inputs failed'));
                    return;
                }
                set_notice('Inputs supplied — run should resume.');
                set_supply_run_id(null);
                void load();
            } catch {
                set_error('Supply inputs failed');
            }
        });
    };

    const handle_cancel = async (run_id: string) => {
        set_notice(null);
        await run_busy(`cancel:${run_id}`, async () => {
            try {
                const res = await auth_fetch('/v1/runs/cancel', {
                    method: 'POST',
                    body: JSON.stringify({ run_id }),
                });
                const data = await res.json();
                if (!data.ok) {
                    set_error(api_err(data, 'Cancel failed'));
                    return;
                }
                set_notice('Cancel dispatched.');
                set_cancel_confirm(null);
                void load();
            } catch {
                set_error('Cancel request failed');
            }
        });
    };

    if (loading && !workspace) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <p className="text-sm text-slate-400">Loading workspace...</p>
            </div>
        );
    }

    if (!workspace) {
        return (
            <div className="py-12 text-center">
                <p className="text-slate-400">{error ?? 'Workspace not found.'}</p>
            </div>
        );
    }

    return (
        <div>
            <ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

            {notice && (
                <div className="mb-4 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
                    <span>{notice}</span>
                    <button type="button" onClick={() => set_notice(null)} className="ml-4 font-bold text-emerald-600 hover:text-emerald-800">&times;</button>
                </div>
            )}

            {/* Header */}
            <div className="mb-8 flex items-start justify-between">
                <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
                        <FolderOpen className="h-6 w-6 text-slate-500" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-slate-900">
                            {workspace.name || workspace.path}
                        </h1>
                        <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                            {workspace.name && (
                                <span className="font-mono">{workspace.path}</span>
                            )}
                            <span>
                                on{' '}
                                <Link
                                    to={`${base_path}/daemons/${workspace.daemon_id}`}
                                    className="text-indigo-600 hover:underline"
                                >
                                    {workspace.daemon_hostname || workspace.daemon_id.slice(0, 8)}
                                </Link>
                            </span>
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => void load()}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                    Refresh
                </button>
            </div>

            {/* Assembled Teams */}
            <section className="mb-8">
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                        Assembled Teams
                    </h2>
                    {teams.length > 0 && !show_run && (
                        <button
                            type="button"
                            onClick={() => set_show_run(true)}
                            className="rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                        >
                            Run…
                        </button>
                    )}
                </div>

                {show_run && (
                    <div className="mb-4">
                        <Run_team_dialog
                            teams={teams.map((t) => ({
                                id: t.team_id,
                                label: `@${t.scope}/${t.slug}`,
                            }))}
                            submitting={is_busy('run')}
                            on_submit={(team_id, inputs) => void handle_run(team_id, inputs)}
                            on_cancel={() => set_show_run(false)}
                        />
                    </div>
                )}

                {teams.length === 0 ? (
                    <div className="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center">
                        <p className="text-sm text-slate-400">No teams assembled.</p>
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                    <th className="px-5 py-2">Team</th>
                                    <th className="px-5 py-2">Assembled</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {teams.map((t) => (
                                    <tr key={t.team_id}>
                                        <td className="px-5 py-3">
                                            <span className="font-mono text-xs font-semibold text-slate-800">
                                                @{t.scope}/{t.slug}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-xs text-slate-400">
                                            {format_relative(typeof t.assembled_at === 'number' ? t.assembled_at : Number(t.assembled_at))}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {/* Run History */}
            <section>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                        Run History
                    </h2>
                    <Link
                        to={`${base_path}/runs`}
                        className="text-xs font-semibold text-indigo-600 hover:underline"
                    >
                        View all runs →
                    </Link>
                </div>
                {runs.length === 0 ? (
                    <div className="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center">
                        <p className="text-sm text-slate-400">No runs yet.</p>
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                    <th className="px-5 py-2">Run</th>
                                    <th className="px-5 py-2">State</th>
                                    <th className="px-5 py-2">Team</th>
                                    <th className="px-5 py-2">Started</th>
                                    <th className="px-5 py-2">Duration</th>
                                    <th className="px-5 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {runs.map((r) => {
                                    const duration_ms = (r.completed_at && r.started_at)
                                        ? r.completed_at - r.started_at
                                        : null;
                                    const duration_label = duration_ms !== null
                                        ? duration_ms < 60000
                                            ? `${Math.round(duration_ms / 1000)}s`
                                            : `${Math.round(duration_ms / 60000)}m`
                                        : '—';
                                    const is_active = r.state === 'running' || r.state === 'awaiting_input';
                                    return (
                                        <tr key={r.run_id}>
                                            <td className="px-5 py-3">
                                                <Link
                                                    to={`${base_path}/runs/${r.run_id}`}
                                                    className="font-mono text-xs text-indigo-600 hover:underline"
                                                >
                                                    {r.run_id.slice(0, 8)}
                                                </Link>
                                            </td>
                                            <td className="px-5 py-3">
                                                <span className={`text-xs font-semibold ${run_state_classes(r.state)}`}>
                                                    {r.state}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3 text-xs text-slate-600">
                                                {r.team_label || '—'}
                                            </td>
                                            <td className="px-5 py-3 text-xs text-slate-400">
                                                {format_relative(r.started_at)}
                                            </td>
                                            <td className="px-5 py-3 text-xs text-slate-400">
                                                {duration_label}
                                            </td>
                                            <td className="px-5 py-3 text-right">
                                                {is_active && (
                                                    <span className="inline-flex flex-col items-end gap-1">
                                                        {r.state === 'awaiting_input' && (
                                                            supply_run_id === r.run_id ? (
                                                                <div className="text-left">
                                                                    <Supply_inputs_dialog
                                                                        run_id={r.run_id}
                                                                        submitting={is_busy(`supply:${r.run_id}`)}
                                                                        on_submit={(inputs) => void handle_supply_inputs(r.run_id, inputs)}
                                                                        on_cancel={() => set_supply_run_id(null)}
                                                                    />
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        set_cancel_confirm(null);
                                                                        set_supply_run_id(r.run_id);
                                                                    }}
                                                                    className="text-[11px] font-semibold text-amber-600 hover:underline"
                                                                >
                                                                    Supply inputs…
                                                                </button>
                                                            )
                                                        )}
                                                        {cancel_confirm === r.run_id ? (
                                                            <Confirm_action
                                                                busy={is_busy(`cancel:${r.run_id}`)}
                                                                busy_label="Cancelling…"
                                                                on_confirm={() => void handle_cancel(r.run_id)}
                                                                on_cancel={() => set_cancel_confirm(null)}
                                                            />
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    set_supply_run_id(null);
                                                                    set_cancel_confirm(r.run_id);
                                                                }}
                                                                className="text-[11px] font-semibold text-red-500 hover:underline"
                                                            >
                                                                Cancel
                                                            </button>
                                                        )}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                <Pagination
                    total={runs_total}
                    offset={runs_offset}
                    limit={PAGE_LIMIT}
                    on_change={set_runs_offset}
                />
            </section>
        </div>
    );
}
