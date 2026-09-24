import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useOrgFetch } from '@/lib/org_context';
import type { TeamListItem } from '@/lib/types';
import { TeamCard } from '@/components/team_card';
import { BrowseHero } from '@/components/browse_hero';
import { Pagination, PAGE_LIMIT, PAGE_SIZE_OPTIONS } from '@/components/pagination';

interface BffTeamListResponse {
    teams: TeamListItem[];
    total: number;
}

const CATEGORIES = [
    { id: 'all', label: 'All' },
    { id: 'agents', label: 'Custom Agents' },
    { id: 'workflows', label: 'Workflows' },
    { id: 'utilities', label: 'Utilities' },
    { id: 'devops', label: 'DevOps' },
    { id: 'testing', label: 'Testing' },
    { id: 'security', label: 'Security' },
];

/** Marketplace browse page — hero, trending, category filters, and card grid. */
export function Component() {
    const api_fetch = useOrgFetch();
    const [params, set_params] = useSearchParams();
    const [teams, set_teams] = useState<TeamListItem[]>([]);
    const [featured, set_featured] = useState<TeamListItem[]>([]);
    const [total, set_total] = useState(0);
    const [loading, set_loading] = useState(true);

    const query = params.get('q') || '';
    const offset = parseInt(params.get('offset') || '0', 10) || 0;
    const limit_raw = parseInt(params.get('limit') || '', 10);
    // Users often want to browse more than the default at once — snap
    // manual URL values back into the selector's allowed set.
    const limit = (PAGE_SIZE_OPTIONS as readonly number[]).includes(limit_raw)
        ? limit_raw
        : PAGE_LIMIT;
    const category = params.get('cat') || 'all';
    const sort = params.get('sort') || 'popular';
    const tag = params.get('tag') || '';

    // Fetch featured teams on mount (top 4 by installs)
    useEffect(() => {
        api_fetch('/v1/teams/get', {
            method: 'POST',
            body: JSON.stringify({ limit: 4, offset: 0, sort: 'popular' }),
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.ok) set_featured(data.data.teams);
            });
    }, [api_fetch]);

    // Fetch main listing
    useEffect(() => {
        set_loading(true);
        const body: Record<string, unknown> = { limit, offset };
        if (query) body.query = query;
        if (category !== 'all') body.category = category;
        if (sort !== 'popular') body.sort = sort;
        if (tag) body.tag = tag;

        api_fetch('/v1/teams/get', {
            method: 'POST',
            body: JSON.stringify(body),
        })
            .then((res) => res.json())
            .then((data) => {
                if (!data.ok) return;
                const d = data.data as BffTeamListResponse;
                set_teams(d.teams);
                set_total(d.total);
            })
            .finally(() => set_loading(false));
    }, [api_fetch, query, offset, limit, category, sort, tag]);

    function handle_search(q: string) {
        const next = new URLSearchParams(params);
        if (q) {
            next.set('q', q);
        } else {
            next.delete('q');
        }
        next.delete('offset');
        set_params(next, { replace: true });
    }

    function set_category(cat: string) {
        const next = new URLSearchParams(params);
        if (cat === 'all') {
            next.delete('cat');
        } else {
            next.set('cat', cat);
        }
        next.delete('offset');
        set_params(next, { replace: true });
    }

    function handle_page_change(new_offset: number) {
        const next = new URLSearchParams(params);
        if (new_offset === 0) {
            next.delete('offset');
        } else {
            next.set('offset', String(new_offset));
        }
        set_params(next, { replace: true });
    }

    function handle_limit_change(new_limit: number) {
        const next = new URLSearchParams(params);
        next.delete('offset');
        if (new_limit === PAGE_LIMIT) next.delete('limit');
        else next.set('limit', String(new_limit));
        set_params(next, { replace: true });
    }

    return (
        <div className="mx-auto max-w-5xl">
            {/* Hero */}
            <BrowseHero query={query} on_search={handle_search} />

            {/* Trending / Featured */}
            {!query && featured.length > 0 && (
                <section className="mt-10">
                    <h2 className="mb-4 text-lg font-bold text-slate-800">
                        Trending this week
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {featured.map((t) => (
                            <TeamCard key={`${t.scope || ''}/${t.name}`} team={t} compact />
                        ))}
                    </div>
                </section>
            )}

            {/* Category chips */}
            <nav className="mt-10 flex flex-wrap gap-2" aria-label="Filter by category">
                {CATEGORIES.map((cat) => (
                    <button
                        key={cat.id}
                        type="button"
                        onClick={() => set_category(cat.id)}
                        className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                            category === cat.id
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                        }`}
                    >
                        {cat.label}
                    </button>
                ))}
            </nav>

            {/* Results heading */}
            <div className="mt-8 flex items-baseline justify-between">
                <h2 className="text-lg font-bold text-slate-800">
                    {query ? `Results for "${query}"` : 'All teams'}
                </h2>
                <span className="text-sm text-slate-400">
                    {loading ? '…' : `${total} team${total !== 1 ? 's' : ''}`}
                </span>
            </div>

            {/* Main grid */}
            {loading ? (
                <div className="flex min-h-[20vh] items-center justify-center">
                    <p className="text-sm text-slate-400">Loading…</p>
                </div>
            ) : teams.length > 0 ? (
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    {teams.map((t) => (
                        <TeamCard key={`${t.scope || ''}/${t.name}`} team={t} />
                    ))}
                </div>
            ) : (
                <p className="py-12 text-center text-slate-400">No teams found.</p>
            )}

            <Pagination
                total={total}
                offset={offset}
                limit={limit}
                on_change={handle_page_change}
                on_limit_change={handle_limit_change}
                label="teams"
            />
        </div>
    );
}
