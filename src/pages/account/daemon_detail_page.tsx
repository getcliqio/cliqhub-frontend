import { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useOutletContext } from 'react-router';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { Pagination, PAGE_LIMIT } from '@/components/pagination';
import { Confirm_action } from '@/components/dispatch/confirm_action';
import { Run_team_dialog, Supply_inputs_dialog } from '@/components/dispatch/run_dialogs';
import { use_busy } from '@/lib/use_busy';
import { use_poll } from '@/lib/use_poll';
import { Cpu } from 'lucide-react';
import type { Realm_outlet_context } from '@/layouts/realm_layout';

interface DaemonInfo {
    id: string;
    name: string | null;
    hostname: string | null;
    status: 'online' | 'stale' | 'offline';
    last_heartbeat: number | null;
    public_url: string | null;
    created_at: number | string;
}

interface InstalledTeam {
    id: string;
    scope_slug: string;
    slug: string;
    version: string | null;
}

interface WorkspaceRow {
    id: string;
    name: string | null;
    path: string;
    teams: string[];
    last_run_state: string | null;
    last_run_at: number | null;
    active_runs?: number;
}

interface RunRow {
    run_id: string;
    state: string;
    team_label: string | null;
    workspace_name: string | null;
    started_at: number | null;
}

function format_relative(ts: number | null): string {
    if (!ts || ts <= 0) return '—';
    const age_s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (age_s < 60) return `${age_s}s ago`;
    if (age_s < 3600) return `${Math.floor(age_s / 60)}m ago`;
    if (age_s < 86400) return `${Math.floor(age_s / 3600)}h ago`;
    return `${Math.floor(age_s / 86400)}d ago`;
}

function status_badge(status: string): { classes: string; label: string } {
    if (status === 'online') return { classes: 'bg-emerald-50 text-emerald-700', label: 'online' };
    if (status === 'stale') return { classes: 'bg-amber-50 text-amber-700', label: 'stale' };
    return { classes: 'bg-slate-100 text-slate-500', label: status };
}

function run_state_classes(state: string): string {
    if (state === 'completed') return 'text-emerald-700';
    if (state === 'failed' || state === 'crashed') return 'text-red-600';
    if (state === 'running') return 'text-indigo-600';
    if (state === 'awaiting_input') return 'text-amber-600';
    return 'text-slate-500';
}

/** Pick list dialog for installing a team on this daemon. */
function InstallTeamDialog({ available_teams, on_submit, on_cancel, submitting }: {
    available_teams: { id: string; scope_slug: string; slug: string }[];
    on_submit: (team_id: string) => void;
    on_cancel: () => void;
    submitting: boolean;
}) {
    const [selected, set_selected] = useState(available_teams[0]?.id ?? '');
    const [filter, set_filter] = useState('');

    const filtered = filter.trim()
        ? available_teams.filter((t) => `@${t.scope_slug}/${t.slug}`.toLowerCase().includes(filter.toLowerCase()))
        : available_teams;

    return (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-indigo-600">Install Team</p>
            {available_teams.length === 0 ? (
                <p className="text-xs text-slate-400">No teams available in your scopes.</p>
            ) : (
                <div className="flex items-end gap-2">
                    <div className="flex-1">
                        <span className="text-[10px] font-semibold uppercase text-slate-400">Team</span>
                        <input
                            type="text"
                            placeholder="Filter teams…"
                            value={filter}
                            onChange={(e) => set_filter(e.target.value)}
                            className="mt-0.5 block w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs"
                        />
                        <select
                            value={selected}
                            onChange={(e) => set_selected(e.target.value)}
                            size={Math.min(filtered.length, 6)}
                            className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1 font-mono text-xs"
                        >
                            {filtered.map((t) => (
                                <option key={t.id} value={t.id}>
                                    @{t.scope_slug}/{t.slug}
                                </option>
                            ))}
                        </select>
                    </div>
                    <button
                        type="button"
                        disabled={!selected || submitting}
                        onClick={() => on_submit(selected)}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {submitting ? 'Installing…' : 'Install'}
                    </button>
                    <button
                        type="button"
                        onClick={on_cancel}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                    >
                        Cancel
                    </button>
                </div>
            )}
        </div>
    );
}

export function Component() {
    const { daemon_id } = useParams<{ daemon_id: string }>();
    const { base_path } = useOutletContext<Realm_outlet_context>();
    const auth_fetch = useOrgFetch();

    const [daemon, set_daemon] = useState<DaemonInfo | null>(null);
    const [installed_teams, set_installed_teams] = useState<InstalledTeam[]>([]);
    const [available_teams, set_available_teams] = useState<{ id: string; scope_slug: string; slug: string }[]>([]);
    const [workspaces, set_workspaces] = useState<WorkspaceRow[]>([]);
    const [runs, set_runs] = useState<RunRow[]>([]);
    const [runs_total, set_runs_total] = useState(0);
    const [runs_offset, set_runs_offset] = useState(0);
    const [ws_offset, set_ws_offset] = useState(0);
    const [teams_offset, set_teams_offset] = useState(0);
    const [loading, set_loading] = useState(true);
    const [error, set_error] = useState<string | null>(null);
    const [notice, set_notice] = useState<string | null>(null);

    /* Dialog visibility toggles */
    const [show_install, set_show_install] = useState(false);
    const [run_ws_id, set_run_ws_id] = useState<string | null>(null);
    const [supply_run_id, set_supply_run_id] = useState<string | null>(null);
    const [cancel_confirm_id, set_cancel_confirm_id] = useState<string | null>(null);
    const [uninstall_confirm_id, set_uninstall_confirm_id] = useState<string | null>(null);
    const { is_busy, run_busy } = use_busy();

    const load = useCallback(async (opts?: { silent?: boolean }) => {
        if (!daemon_id) return;
        if (!opts?.silent) set_loading(true);
        try {
            const [daemon_res, teams_res, catalog_res, ws_res, runs_res] = await Promise.all([
                auth_fetch('/v1/daemons/get_by_id', {
                    method: 'POST',
                    body: JSON.stringify({ daemon_id }),
                }),
                auth_fetch('/v1/teams/get', {
                    method: 'POST',
                    body: JSON.stringify({ daemon_id }),
                }),
                auth_fetch('/v1/teams/get', {
                    method: 'POST',
                    body: JSON.stringify({ mine: true, group_by_scope: true }),
                }),
                auth_fetch('/v1/workspaces/get', {
                    method: 'POST',
                    body: JSON.stringify({ daemon_id }),
                }),
                auth_fetch('/v1/runs/get', {
                    method: 'POST',
                    body: JSON.stringify({
                        daemon_id,
                        limit: PAGE_LIMIT,
                        offset: runs_offset,
                    }),
                }),
            ]);

            const daemon_data = await daemon_res.json();
            if (daemon_data.ok && daemon_data.daemon) {
                set_daemon(daemon_data.daemon);
            }

            const teams_data = await teams_res.json();
            if (teams_data.ok) {
                // Live: { ok, data: <daemon envelope> } where envelope.payload.data.teams = [...]
                const daemon_teams = teams_data.data?.payload?.data?.teams
                    ?? teams_data.data?.teams
                    ?? teams_data.teams
                    ?? [];
                set_installed_teams(daemon_teams.map((t: any) => ({
                    id: t.team_id ?? t.id ?? '',
                    scope_slug: t.scope ?? t.scope_slug ?? '',
                    slug: t.slug ?? '',
                    version: t.version ?? null,
                })));
            }

            const catalog_data = await catalog_res.json();
            if (catalog_data.ok) {
                const scopes = catalog_data.data?.scopes ?? [];
                const flat: { id: string; scope_slug: string; slug: string }[] = [];
                for (const sg of scopes as Array<{ slug: string; teams: Array<{ name: string; scope?: string; id?: string }> }>) {
                    for (const t of sg.teams ?? []) {
                        flat.push({
                            id: t.id ?? `${sg.slug}/${t.name}`,
                            scope_slug: sg.slug,
                            slug: t.name,
                        });
                    }
                }
                set_available_teams(flat);
            }

            const ws_data = await ws_res.json();
            if (ws_data.ok) {
                const raw_ws = ws_data.data?.payload?.data?.workspaces
                    ?? ws_data.data?.workspaces
                    ?? ws_data.workspaces
                    ?? [];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                set_workspaces(raw_ws.map((ws: any) => ({
                    id: ws.workspace_id ?? ws.id ?? '',
                    name: ws.name ?? null,
                    path: ws.workspace_dir ?? ws.path ?? '',
                    teams: (ws.teams ?? []).map((t: { scope?: string; slug?: string }) =>
                        t.scope && t.slug ? `@${t.scope}/${t.slug}` : String(t),
                    ),
                    last_run_state: ws.last_run?.state ?? ws.last_run_state ?? null,
                    last_run_at: ws.last_run?.started_at ?? ws.last_run_at ?? null,
                    active_runs: ws.active_runs ?? 0,
                })));
            }

            const runs_data = await runs_res.json();
            if (runs_data.ok) {
                set_runs(runs_data.runs ?? []);
                set_runs_total(Number(runs_data.total ?? (runs_data.runs ?? []).length));
            }

            set_error(null);
        } catch {
            if (!opts?.silent) set_error('Failed to load daemon details');
        } finally {
            if (!opts?.silent) set_loading(false);
        }
    }, [auth_fetch, daemon_id, runs_offset]);

    useEffect(() => {
        void load();
    }, [load]);

    const has_active_runs = runs.some((r) => r.state === 'running' || r.state === 'awaiting_input');
    use_poll(() => void load({ silent: true }), has_active_runs ? 5_000 : 15_000, !loading);

    /* --- Dispatch actions --- */

    const api_err = (data: { error?: unknown }, fallback: string) => {
        const err = data.error;
        if (typeof err === 'string') return err;
        if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
            return (err as { message: string }).message;
        }
        return fallback;
    };

    const handle_install_team = async (team_id: string) => {
        set_notice(null);
        await run_busy('install', async () => {
            try {
                const res = await auth_fetch('/v1/teams/install', {
                    method: 'POST',
                    body: JSON.stringify({ team_id, daemon_ids: [daemon_id] }),
                });
                const data = await res.json();
                if (!data.ok) {
                    set_error(api_err(data, 'Install failed'));
                    return;
                }
                if (data.results?.[0]?.already_installed) {
                    set_notice('Team is already installed on this daemon.');
                    set_show_install(false);
                    void load();
                    return;
                }
                set_notice('Install dispatched — team will appear once the daemon finishes.');
                set_show_install(false);
                void load();
            } catch {
                set_error('Install request failed');
            }
        });
    };



    const handle_run = async (
        workspace_id: string,
        workspace_path: string,
        team_id: string,
        inputs?: Record<string, string>,
    ) => {
        await run_busy(`run:${workspace_id}`, async () => {
            try {
                const res = await auth_fetch('/v1/runs/enqueue', {
                    method: 'POST',
                    body: JSON.stringify({
                        workspace_id,
                        team_id,
                        daemon_id,
                        workspace_path,
                        inputs: inputs && Object.keys(inputs).length > 0 ? inputs : undefined,
                    }),
                });
                const data = await res.json();
                if (!data.ok) {
                    set_error(api_err(data, 'Run dispatch failed'));
                    return;
                }
                const run_id = typeof data.run_id === 'string' ? data.run_id : null;
                set_notice(run_id
                    ? `Run dispatched (${run_id.slice(0, 8)}…). Watch notifications for progress.`
                    : 'Run dispatched. Watch notifications for progress.');
                set_run_ws_id(null);
                void load();
            } catch {
                set_error('Run dispatch failed');
            }
        });
    };

    const handle_cancel = async (run_id: string) => {
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
                set_cancel_confirm_id(null);
                void load();
            } catch {
                set_error('Cancel request failed');
            }
        });
    };

    const handle_supply_inputs = async (run_id: string, inputs: Record<string, string>) => {
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

    const handle_uninstall = async (team: InstalledTeam) => {
        await run_busy(`uninstall:${team.id}`, async () => {
            try {
                const res = await auth_fetch('/v1/teams/uninstall', {
                    method: 'POST',
                    body: JSON.stringify({
                        daemon_id,
                        scope: team.scope_slug,
                        slug: team.slug,
                    }),
                });
                const data = await res.json();
                if (!data.ok) {
                    set_error(api_err(data, 'Uninstall failed'));
                    return;
                }
                set_notice(`Uninstall dispatched for @${team.scope_slug}/${team.slug}.`);
                set_uninstall_confirm_id(null);
                void load();
            } catch {
                set_error('Uninstall request failed');
            }
        });
    };

    if (loading && !daemon) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <p className="text-sm text-slate-400">Loading daemon...</p>
            </div>
        );
    }

    if (!daemon) {
        return (
            <div className="py-12 text-center">
                <p className="text-slate-400">Daemon not found.</p>
            </div>
        );
    }

    const badge = status_badge(daemon.status);
    const is_online = daemon.status === 'online';
    const daemon_label = daemon.name || daemon.hostname || daemon.id.slice(0, 8);
    const ws_page = workspaces.slice(ws_offset, ws_offset + PAGE_LIMIT);
    const teams_page = installed_teams.slice(teams_offset, teams_offset + PAGE_LIMIT);

    return (
        <div>
            <ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

            {notice ? (
                <div className="mb-4 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
                    <span>{notice}</span>
                    <button type="button" onClick={() => set_notice(null)} className="ml-4 font-bold text-emerald-600 hover:text-emerald-800">&times;</button>
                </div>
            ) : null}

            {/* Header — matches workspace / list detail chrome */}
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
                        <Cpu className="h-6 w-6 text-slate-500" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                            {daemon_label}
                        </h1>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.classes}`}>
                                {badge.label}
                            </span>
                            <span>Last seen {format_relative(daemon.last_heartbeat)}</span>
                            {daemon.hostname && daemon.name ? (
                                <span className="font-mono">{daemon.hostname}</span>
                            ) : null}
                            {daemon.public_url ? (
                                <span className="font-mono">{daemon.public_url}</span>
                            ) : null}
                        </div>
                        <p className="mt-1 font-mono text-[10px] text-slate-400">{daemon.id}</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {is_online ? (
                        <button
                            type="button"
                            onClick={() => set_show_install(true)}
                            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                        >
                            Install team…
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => void load({ silent: true })}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {!is_online ? (
                <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Daemon is offline — dispatch is paused until it reconnects.
                </div>
            ) : null}

            {show_install ? (
                <div className="mb-6">
                    <InstallTeamDialog
                        available_teams={available_teams}
                        on_submit={(team_id) => void handle_install_team(team_id)}
                        on_cancel={() => set_show_install(false)}
                        submitting={is_busy('install')}
                    />
                </div>
            ) : null}


            {/* Runs — primary */}
            <section className="mb-8">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                        Runs
                    </h2>
                    <Link
                        to={`${base_path}/runs`}
                        className="text-xs font-semibold text-indigo-600 hover:underline"
                    >
                        View all runs →
                    </Link>
                </div>
                {runs.length === 0 ? (
                    <div className="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center dark:border-slate-700">
                        <p className="text-sm text-slate-400">No runs on this daemon yet.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                        <table className="w-full min-w-[40rem] text-sm">
                            <thead>
                                <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                                    <th className="px-5 py-2">Run</th>
                                    <th className="px-5 py-2">State</th>
                                    <th className="px-5 py-2">Team</th>
                                    <th className="px-5 py-2">Workspace</th>
                                    <th className="px-5 py-2">Started</th>
                                    <th className="px-5 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                                {runs.map((r) => {
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
                                            <td className="px-5 py-3 text-xs text-slate-600 dark:text-slate-300">
                                                {r.team_label || '—'}
                                            </td>
                                            <td className="px-5 py-3 text-xs text-slate-500">
                                                {r.workspace_name || '—'}
                                            </td>
                                            <td className="px-5 py-3 text-xs text-slate-400">
                                                {format_relative(r.started_at)}
                                            </td>
                                            <td className="px-5 py-3 text-right">
                                                {is_active && is_online ? (
                                                    <span className="inline-flex flex-col items-end gap-1">
                                                        {r.state === 'awaiting_input' ? (
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
                                                                        set_cancel_confirm_id(null);
                                                                        set_supply_run_id(r.run_id);
                                                                    }}
                                                                    className="text-[11px] font-semibold text-amber-600 hover:underline"
                                                                >
                                                                    Supply inputs…
                                                                </button>
                                                            )
                                                        ) : null}
                                                        {cancel_confirm_id === r.run_id ? (
                                                            <Confirm_action
                                                                busy={is_busy(`cancel:${r.run_id}`)}
                                                                busy_label="Cancelling…"
                                                                on_confirm={() => void handle_cancel(r.run_id)}
                                                                on_cancel={() => set_cancel_confirm_id(null)}
                                                            />
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    set_supply_run_id(null);
                                                                    set_cancel_confirm_id(r.run_id);
                                                                }}
                                                                className="text-[11px] font-semibold text-red-500 hover:underline"
                                                            >
                                                                Cancel
                                                            </button>
                                                        )}
                                                    </span>
                                                ) : (
                                                    <span className="text-[11px] text-slate-300">—</span>
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
                    label="runs"
                />
            </section>

            {/* Workspaces */}
            <section className="mb-8">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                        Workspaces
                    </h2>
                </div>
                {run_ws_id && workspaces.some((w) => w.id === run_ws_id) ? (
                    <div className="mb-4">
                        <Run_team_dialog
                            teams={installed_teams
                                .filter((t) => {
                                    const ws = workspaces.find((w) => w.id === run_ws_id);
                                    if (!ws) return false;
                                    return ws.teams.includes(`@${t.scope_slug}/${t.slug}`);
                                })
                                .map((t) => ({
                                    id: t.id,
                                    label: `@${t.scope_slug}/${t.slug}`,
                                }))}
                            submitting={is_busy(`run:${run_ws_id}`)}
                            on_submit={(team_id, inputs) => {
                                const ws = workspaces.find((w) => w.id === run_ws_id);
                                if (!ws) return;
                                void handle_run(ws.id, ws.path, team_id, inputs);
                            }}
                            on_cancel={() => set_run_ws_id(null)}
                        />
                    </div>
                ) : null}
                {workspaces.length === 0 ? (
                    <div className="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center dark:border-slate-700">
                        <p className="text-sm text-slate-400">No workspaces yet.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                        <table className="w-full min-w-[36rem] text-sm">
                            <thead>
                                <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                                    <th className="px-5 py-2">Workspace</th>
                                    <th className="px-5 py-2">Teams</th>
                                    <th className="px-5 py-2">Last run</th>
                                    <th className="px-5 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                                {ws_page.map((ws) => (
                                    <tr key={ws.id}>
                                        <td className="px-5 py-3">
                                            <Link
                                                to={`${base_path}/workspaces/${ws.id}`}
                                                className="font-semibold text-slate-900 hover:text-indigo-600 dark:text-slate-100"
                                            >
                                                {ws.name || ws.path}
                                            </Link>
                                            {ws.name ? (
                                                <p className="mt-0.5 font-mono text-[11px] text-slate-400">{ws.path}</p>
                                            ) : null}
                                        </td>
                                        <td className="px-5 py-3 text-xs text-slate-600 dark:text-slate-300">
                                            {ws.teams.length > 0 ? ws.teams.join(', ') : '—'}
                                        </td>
                                        <td className="px-5 py-3">
                                            {ws.last_run_state ? (
                                                <span className={`text-xs font-semibold ${run_state_classes(ws.last_run_state)}`}>
                                                    {ws.last_run_state}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-slate-400">idle</span>
                                            )}
                                            {ws.last_run_at ? (
                                                <p className="text-[10px] text-slate-400">{format_relative(ws.last_run_at)}</p>
                                            ) : null}
                                        </td>
                                        <td className="px-5 py-3 text-right">
                                            {is_online && ws.teams.length > 0 ? (
                                                <button
                                                    type="button"
                                                    onClick={() => set_run_ws_id(ws.id)}
                                                    className="text-xs font-semibold text-emerald-600 hover:underline"
                                                >
                                                    Run…
                                                </button>
                                            ) : (
                                                <span className="text-[11px] text-slate-300">—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <Pagination
                    total={workspaces.length}
                    offset={ws_offset}
                    limit={PAGE_LIMIT}
                    on_change={set_ws_offset}
                    label="workspaces"
                />
            </section>

            {/* Installed teams */}
            <section className="mb-8">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                        Installed teams
                    </h2>
                    {is_online ? (
                        <button
                            type="button"
                            onClick={() => set_show_install(true)}
                            className="text-xs font-semibold text-indigo-600 hover:underline"
                        >
                            Install team…
                        </button>
                    ) : null}
                </div>
                {installed_teams.length === 0 ? (
                    <div className="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center dark:border-slate-700">
                        <p className="text-sm text-slate-400">No teams installed on this daemon.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                        <table className="w-full min-w-[28rem] text-sm">
                            <thead>
                                <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                                    <th className="px-5 py-2">Team</th>
                                    <th className="px-5 py-2">Version</th>
                                    <th className="px-5 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                                {teams_page.map((t) => (
                                    <tr key={t.id}>
                                        <td className="px-5 py-3 font-mono text-xs font-semibold text-slate-800 dark:text-slate-100">
                                            @{t.scope_slug}/{t.slug}
                                        </td>
                                        <td className="px-5 py-3 text-xs text-slate-500">{t.version || '—'}</td>
                                        <td className="px-5 py-3 text-right">
                                            {is_online ? (
                                                uninstall_confirm_id === t.id ? (
                                                    <Confirm_action
                                                        busy={is_busy(`uninstall:${t.id}`)}
                                                        busy_label="Removing…"
                                                        confirm_label="Confirm remove"
                                                        on_confirm={() => void handle_uninstall(t)}
                                                        on_cancel={() => set_uninstall_confirm_id(null)}
                                                    />
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => set_uninstall_confirm_id(t.id)}
                                                        className="text-[11px] font-semibold text-red-500 hover:underline"
                                                    >
                                                        Remove
                                                    </button>
                                                )
                                            ) : (
                                                <span className="text-[11px] text-slate-300">—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <Pagination
                    total={installed_teams.length}
                    offset={teams_offset}
                    limit={PAGE_LIMIT}
                    on_change={set_teams_offset}
                    label="teams"
                />
            </section>
        </div>
    );
}
