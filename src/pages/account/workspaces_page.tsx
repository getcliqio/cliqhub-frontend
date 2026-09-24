import { useState, useEffect, useCallback } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { PageHeader } from '@/components/ui/page_header';
import { Pagination, PAGE_LIMIT } from '@/components/pagination';
import { PAGE_HELP } from '@/lib/page_help';
import { use_poll } from '@/lib/use_poll';
import { FolderOpen } from 'lucide-react';
import type { Realm_outlet_context } from '@/layouts/realm_layout';

interface WorkspaceRow {
    id: string;
    name: string | null;
    path: string;
    daemon_id: string | null;
    daemon_hostname: string | null;
    teams: string[];
    last_run_state: string | null;
    last_run_at: number | null;
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

function map_workspace_row(raw: Record<string, unknown>): WorkspaceRow {
    const teams_raw = raw.teams;
    let teams: string[] = [];
    if (Array.isArray(teams_raw)) {
        teams = teams_raw.map((t) => {
            if (typeof t === 'string') return t;
            if (t && typeof t === 'object') {
                const obj = t as { scope?: string; slug?: string };
                if (obj.scope && obj.slug) return `@${obj.scope}/${obj.slug}`;
                return obj.slug ?? '';
            }
            return '';
        }).filter(Boolean);
    }
    const latest = raw.latest_run as { state?: string; started_at?: number } | null | undefined;
    return {
        id: String(raw.id ?? raw.workspace_id ?? ''),
        name: (raw.name as string | null | undefined) ?? null,
        path: String(raw.path ?? raw.workspace_dir ?? ''),
        daemon_id: (raw.daemon_id as string | null | undefined) ?? null,
        daemon_hostname: (raw.daemon_hostname as string | null | undefined) ?? null,
        teams,
        last_run_state: latest?.state ?? (raw.last_run_state as string | null | undefined) ?? null,
        last_run_at: latest?.started_at ?? (raw.last_run_at as number | null | undefined) ?? null,
    };
}

export function Component() {
    const { realm, base_path } = useOutletContext<Realm_outlet_context>();
    const auth_fetch = useOrgFetch();
    const [search_params, set_search_params] = useSearchParams();
    const offset = Math.max(0, Number(search_params.get('offset') ?? '0') || 0);

    const [workspaces, set_workspaces] = useState<WorkspaceRow[]>([]);
    const [total, set_total] = useState(0);
    const [loading, set_loading] = useState(true);
    const [error, set_error] = useState<string | null>(null);

    const load = useCallback(async () => {
        set_loading(true);
        try {
            const res = await auth_fetch('/v1/workspaces/get', {
                method: 'POST',
                body: JSON.stringify({
                    realm_id: realm.id,
                    limit: PAGE_LIMIT,
                    offset,
                }),
            });
            const data = await res.json();
            if (data.ok) {
                const rows = ((data.workspaces ?? []) as Record<string, unknown>[]).map(map_workspace_row);
                set_workspaces(rows);
                set_total(Number(data.total ?? rows.length));
                set_error(null);
                return;
            }
            set_error(typeof data.error === 'string' ? data.error : data.error?.message ?? 'Request failed');
        } catch {
            set_error('Failed to load workspaces');
        } finally {
            set_loading(false);
        }
    }, [auth_fetch, realm.id, offset]);

    useEffect(() => {
        void load();
    }, [load]);

    use_poll(() => void load(), 10_000, !loading);

    function set_offset(next_offset: number) {
        const next = new URLSearchParams(search_params);
        if (next_offset <= 0) next.delete('offset');
        else next.set('offset', String(next_offset));
        set_search_params(next, { replace: true });
    }

    if (loading && workspaces.length === 0) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <p className="text-sm text-slate-400">Loading workspaces...</p>
            </div>
        );
    }

    return (
        <div>
            <PageHeader
                icon={FolderOpen}
                title="Workspaces"
                description={<>All workspaces across daemons in <span className="font-mono">{realm.slug}</span></>}
                help={PAGE_HELP.workspaces.help}
                docs_href={PAGE_HELP.workspaces.docs_href}
                actions={(
                    <button
                        type="button"
                        onClick={() => void load()}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                        Refresh
                    </button>
                )}
            />

            <ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

            {workspaces.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
                    <p className="text-slate-400">No workspaces in this realm yet.</p>
                    <p className="mt-2 text-xs text-slate-400">
                        Workspaces appear when daemons register them via <code className="rounded bg-slate-100 px-1">cliq init</code>.
                    </p>
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                <th className="px-5 py-2">Workspace</th>
                                <th className="px-5 py-2">Daemon</th>
                                <th className="px-5 py-2">Teams</th>
                                <th className="px-5 py-2">Last run</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {workspaces.map((ws) => (
                                <tr key={ws.id} className="hover:bg-slate-25">
                                    <td className="px-5 py-3">
                                        <Link
                                            to={`${base_path}/workspaces/${ws.id}`}
                                            className="group"
                                        >
                                            <p className="font-mono text-xs font-semibold text-slate-800 group-hover:text-indigo-600">
                                                {ws.name || ws.path}
                                            </p>
                                            {ws.name && (
                                                <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                                                    {ws.path}
                                                </p>
                                            )}
                                        </Link>
                                    </td>
                                    <td className="px-5 py-3">
                                        {ws.daemon_id ? (
                                            <Link
                                                to={`${base_path}/daemons/${ws.daemon_id}`}
                                                className="font-mono text-xs text-indigo-600 hover:underline"
                                            >
                                                {ws.daemon_hostname || ws.daemon_id.slice(0, 8)}
                                            </Link>
                                        ) : (
                                            <span className="text-xs text-slate-400">—</span>
                                        )}
                                    </td>
                                    <td className="px-5 py-3 text-xs text-slate-600">
                                        {ws.teams.length > 0 ? ws.teams.join(', ') : '—'}
                                    </td>
                                    <td className="px-5 py-3 text-xs">
                                        {ws.last_run_state ? (
                                            <span className={run_state_classes(ws.last_run_state)}>
                                                {ws.last_run_state} {format_relative(ws.last_run_at)}
                                            </span>
                                        ) : (
                                            <span className="text-slate-400">none</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <Pagination total={total} offset={offset} limit={PAGE_LIMIT} on_change={set_offset} />
        </div>
    );
}
