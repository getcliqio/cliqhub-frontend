import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { useAuth} from '@/lib/auth_context';
import { useOrgFetch } from '@/lib/org_context';
import { Pagination, PAGE_LIMIT } from '@/components/pagination';

interface TeamRow {
    name: string;
    scope: string | null;
    description: string;
    latest_version: string;
    install_count: number;
    tags: string[];
    listed?: boolean;
}

export function Component() {
    const params = useParams();
    const slug = params.slug as string;
    const { scopes } = useAuth();
    const auth_fetch = useOrgFetch();

    const [teams, set_teams] = useState<TeamRow[]>([]);
    const [total, set_total] = useState(0);
    const [offset, set_offset] = useState(0);
    const [loading, set_loading] = useState(true);
    const [error, set_error] = useState('');

    const scope_info = scopes.find((s) => s.slug === slug);

    const load = useCallback(async () => {
        set_loading(true);
        try {
            const res = await auth_fetch('/v1/teams/get', {
                method: 'POST',
                body: JSON.stringify({ scope: slug, mine: true, limit: PAGE_LIMIT, offset }),
            });
            const data = await res.json();
            if (data.ok) {
                set_teams(data.data.teams);
                set_total(data.data.total ?? data.data.teams.length);
            }
            if (!data.ok) {
                set_error(data.error?.message || 'Failed to load teams');
            }
        } catch {
            set_error('Network error');
        } finally {
            set_loading(false);
        }
    }, [auth_fetch, slug, offset]);

    useEffect(() => { set_offset(0); }, [slug]);
    useEffect(() => { load(); }, [load]);

    if (loading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <p className="text-sm text-slate-400">Loading...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
                <p className="text-sm text-red-500">{error}</p>
                <Link to="/teams" className="text-sm text-indigo-600 hover:underline">
                    Back to Teams
                </Link>
            </div>
        );
    }

    return (
        <div>
            <div className="mb-8">
                <Link to="/teams" className="mb-2 inline-block text-xs text-slate-400 hover:text-slate-600">
                    &larr; Teams
                </Link>
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-extrabold">@{slug}</h1>
                    {scope_info && scope_info.display_name !== slug && (
                        <span className="text-lg text-slate-400">{scope_info.display_name}</span>
                    )}
                    {scope_info && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            scope_info.visibility === 'public'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-amber-50 text-amber-700'
                        }`}>
                            {scope_info.visibility}
                        </span>
                    )}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                    {total} team{total !== 1 ? 's' : ''}
                </p>
            </div>

            {teams.length === 0 && offset === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
                    <p className="text-sm text-slate-400">No teams in this scope yet.</p>
                    <Link to="/builder" className="mt-3 inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-700">
                        Build your first team
                    </Link>
                </div>
            ) : (
                <div className="space-y-3">
                    {teams.map((team) => {
                        const scope_prefix = team.scope ? `@${team.scope}/` : '';
                        const detail_url = `/browse/${team.scope || '_'}/${team.name}`;
                        const is_listed = team.listed !== false;

                        return (
                            <div
                                key={`${team.scope}/${team.name}`}
                                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-3">
                                        <Link to={detail_url} className="font-mono text-sm font-bold text-indigo-600 hover:text-indigo-700">
                                            {scope_prefix}{team.name}
                                        </Link>
                                        {team.latest_version && (
                                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                                                v{team.latest_version}
                                            </span>
                                        )}
                                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                            is_listed
                                                ? 'bg-emerald-50 text-emerald-700'
                                                : 'bg-amber-50 text-amber-700'
                                        }`}>
                                            {is_listed ? '\u25CF Listed' : '\u25CB Unlisted'}
                                        </span>
                                    </div>
                                    <p className="mt-1 truncate text-sm text-slate-500">{team.description}</p>
                                    <div className="mt-2 flex items-center gap-4 text-xs text-slate-400">
                                        <span>{team.install_count.toLocaleString()} installs</span>
                                        {team.tags.length > 0 && (
                                            <span>{team.tags.join(', ')}</span>
                                        )}
                                    </div>
                                </div>

                                <div className="ml-4 flex shrink-0 items-center gap-2">
                                    <Link
                                        to={detail_url}
                                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                    >
                                        View / Edit
                                    </Link>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <Pagination total={total} offset={offset} on_change={set_offset} />
        </div>
    );
}
