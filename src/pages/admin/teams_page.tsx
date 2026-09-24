import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useAuthFetch } from '@/lib/auth_context';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

interface AdminTeam {
    id: number;
    name: string;
    scope: string | null;
    description: string;
    author_id: number | null;
    author_username: string | null;
    visibility: string;
    listed: number;
    install_count: number;
    version_count: number;
    created_at: string;
    updated_at: string;
}

export function Component() {
    const auth_fetch = useAuthFetch();
    const navigate = useNavigate();
    const [teams, setTeams] = useState<AdminTeam[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [filter_draft, set_filter_draft] = useState('');
    const [listed_draft, set_listed_draft] = useState<'' | 'true' | 'false'>('');
    const [active_query, set_active_query] = useState('');
    const [active_listed, set_active_listed] = useState<'' | 'true' | 'false'>('');
    const [loading, setLoading] = useState(true);
    const [action_error, setActionError] = useState('');

    const LIMIT = 20;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const body: Record<string, unknown> = { limit: LIMIT, offset };
            const query = active_query.trim();
            if (query) body.query = query;
            if (active_listed !== '') body.listed = active_listed === 'true';
            const res = await auth_fetch('/v1/teams/get', { method: 'POST', body: JSON.stringify(body) });
            const data = await res.json();
            if (data.ok) { setTeams(data.data.teams); setTotal(data.data.total); }
            if (!data.ok) { setActionError(data.error?.message || 'Failed to load teams'); }
        } catch (err: unknown) {
            setActionError(err instanceof Error ? err.message : 'Failed to load teams');
        }
        setLoading(false);
    }, [auth_fetch, offset, active_query, active_listed]);

    useEffect(() => { load(); }, [load]);

    function apply_filter(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = event.currentTarget;
        const raw_query = new FormData(form).get('query');
        const query = typeof raw_query === 'string' ? raw_query.trim() : filter_draft.trim();
        const raw_listed = new FormData(form).get('listed');
        const listed = (typeof raw_listed === 'string' ? raw_listed : listed_draft) as '' | 'true' | 'false';
        set_filter_draft(query);
        set_listed_draft(listed);
        set_active_query(query);
        set_active_listed(listed);
        setOffset(0);
    }

    async function handle_set_listed(e: React.MouseEvent, team: AdminTeam, listed: boolean) {
        e.stopPropagation();
        try {
            const res = await auth_fetch(
                listed ? '/v1/teams/publish' : '/v1/teams/unpublish',
                {
                    method: 'POST',
                    body: JSON.stringify(
                        listed
                            ? { team_id: team.id, visibility: 'public' }
                            : { team_id: team.id },
                    ),
                },
            );
            const data = await res.json();
            if (data.ok) load();
            else setActionError(data.error?.message || 'Failed');
        } catch (err: unknown) {
            setActionError(err instanceof Error ? err.message : 'Failed to update listed status');
        }
    }

    function team_label(t: AdminTeam) {
        return t.scope ? `@${t.scope}/${t.name}` : t.name;
    }

    function team_url(t: AdminTeam) {
        return t.scope ? `/admin/teams/${t.scope}/${t.name}` : `/admin/teams/_/${t.name}`;
    }

    const total_pages = Math.ceil(total / LIMIT);
    const current_page = Math.floor(offset / LIMIT) + 1;

    return (
        <div>
        <Breadcrumbs items={[{ label: 'Admin', to: '/admin' }, { label: 'Teams' }]} />
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Admin · Teams</h1>
            <p className="mt-1 mb-4 text-sm text-slate-500">All published / unlisted teams · {total} total</p>

            <form
                onSubmit={apply_filter}
                className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
            >
                <label className="min-w-[12rem] flex-1 text-xs font-semibold text-slate-600">
                    Filter
                    <input
                        name="query"
                        type="text"
                        placeholder="team name"
                        value={filter_draft}
                        onChange={(e) => set_filter_draft(e.target.value)}
                        aria-label="Filter teams"
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                    Visibility
                    <select
                        name="listed"
                        value={listed_draft}
                        onChange={(e) => set_listed_draft(e.target.value as '' | 'true' | 'false')}
                        className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                        <option value="">All</option>
                        <option value="true">Listed</option>
                        <option value="false">Unlisted</option>
                    </select>
                </label>
                <button
                    type="submit"
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                    Apply
                </button>
                {(active_query || active_listed) && (
                    <button
                        type="button"
                        onClick={() => {
                            set_filter_draft('');
                            set_listed_draft('');
                            set_active_query('');
                            set_active_listed('');
                            setOffset(0);
                        }}
                        className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                    >
                        Clear
                    </button>
                )}
            </form>

            {action_error && <p className="mb-3 text-xs text-red-500">{action_error}</p>}

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-600">
                        <tr>
                            <th className="px-4 py-3">Team</th>
                            <th className="px-4 py-3">Author</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Versions</th>
                            <th className="px-4 py-3">Installs</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-600">Loading...</td></tr>}
                        {!loading && teams.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-600">No teams found</td></tr>}
                        {!loading && teams.map((t) => (
                            <tr key={t.id} onClick={() => navigate(team_url(t))} className="cursor-pointer hover:bg-slate-50">
                                <td className="px-4 py-3">
                                    <span className="font-medium text-slate-900">{team_label(t)}</span>
                                </td>
                                <td className="px-4 py-3 text-slate-700">{t.author_username ? `@${t.author_username}` : '—'}</td>
                                <td className="px-4 py-3">
                                    <button
                                        onClick={(e) => handle_set_listed(e, t, !t.listed)}
                                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.listed ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                    >
                                        {t.listed ? '● Listed' : '○ Unlisted'}
                                    </button>
                                </td>
                                <td className="px-4 py-3 text-slate-700">{t.version_count}</td>
                                <td className="px-4 py-3 text-slate-700">{t.install_count.toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {total_pages > 1 && (
                <div className="mt-4 flex items-center justify-between text-sm">
                    <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40">← Prev</button>
                    <span className="text-xs text-slate-600">Page {current_page} of {total_pages}</span>
                    <button onClick={() => setOffset(offset + LIMIT)} disabled={current_page >= total_pages} className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Next →</button>
                </div>
            )}
        </div>
    );
}
