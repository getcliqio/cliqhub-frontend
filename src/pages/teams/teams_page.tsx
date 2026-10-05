/**
 * Marketplace (Graphite) — every listed team, searchable, sortable, by tag.
 * Read: `POST /v1/teams/get` per page (Core catalog through the BFF).
 * Signed in, a card opens the Graphite team page; signed out, the public
 * detail page under /browse.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Download, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { useOrgFetch } from '@/lib/org_context';
import type { TeamListItem } from '@/lib/types';
import { team_href } from '@/lib/team_page';
import { Team_avatar } from '@/pages/teams/teams_graphite_page';

interface BffTeamListResponse {
	teams: TeamListItem[];
	total: number;
}

export const PAGE_SIZE = 24;

/**
 * Sort pill (`?sort=`) → Core `teams/get` sort (Core API 6). `popular` is
 * Core's default order (most installed first), so it sends nothing.
 */
export const CATALOG_SORT_BODY: Readonly<Record<string, { sort_by: string; sort_dir: 'asc' | 'desc' }>> = {
	recent: { sort_by: 'updated_at', sort_dir: 'desc' },
	name: { sort_by: 'name', sort_dir: 'asc' },
};

const SORTS = [
	{ id: 'popular', label: 'Most popular' },
	{ id: 'recent', label: 'Recently updated' },
	{ id: 'name', label: 'Name A–Z' },
];

/* No category filter: Core has no category field and its tags are free-form (team.yml). */
const POPULAR_TAGS = ['code-review', 'devops', 'documentation', 'testing', 'security', 'data'];

const PILL = (on: boolean) => `inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] ${on ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;
const TAG = (on: boolean) => `rounded-md px-2 py-0.5 text-[11.5px] ${on ? 'bg-[var(--g-acc-soft)] text-[var(--g-acc)]' : 'bg-[var(--g-soft)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;

function short_date(iso: string): string {
	const d = new Date(iso);
	const same_year = d.getFullYear() === new Date().getFullYear();
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(same_year ? {} : { year: 'numeric' }) });
}

/** One catalog card. */
export function Market_card({ team, href }: { team: TeamListItem; href: string }) {
	return (
		<Link
			to={href}
			className="group flex flex-col rounded-[12px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4 transition-colors hover:border-[#34373e] hover:bg-[var(--g-soft)]"
			data-testid={`market-${team.scope ?? '_'}/${team.name}`}
		>
			<div className="flex items-start gap-3">
				<Team_avatar name={team.name} />
				<div className="min-w-0 flex-1">
					<h3 className="truncate text-[14px] font-semibold text-[var(--g-ink)] group-hover:underline">{team.name}</h3>
					<p className="truncate text-[11.5px] text-[var(--g-ink-3)]">
						{team.scope ? <span className="g-mono">@{team.scope}</span> : null}
						{team.scope && team.author ? ' · ' : null}
						{team.author ? `by ${team.author}` : null}
					</p>
				</div>
				{team.latest_version ? <span className="g-mono shrink-0 rounded-[5px] bg-[var(--g-soft)] px-1.5 py-px text-[11px] text-[var(--g-ink-2)]">v{team.latest_version}</span> : null}
			</div>
			<p className="mt-3 line-clamp-2 min-h-[2.6em] flex-1 text-[12.5px] leading-[1.3] text-[var(--g-ink-3)]">{team.description || 'No description.'}</p>
			<div className="mt-3 flex items-center gap-3 border-t border-[var(--g-line-2)] pt-3 text-[11.5px] text-[var(--g-ink-3)]">
				<span className="inline-flex items-center gap-1" title="Installs"><Download aria-hidden className="h-3 w-3" />{team.install_count.toLocaleString()}</span>
				{team.updated_at ? <span>Updated {short_date(team.updated_at)}</span> : null}
				{team.has_agents ? <span className="rounded-[5px] bg-[rgba(182,156,255,.13)] px-1.5 py-px text-[var(--g-t-team)]">Agents</span> : null}
				{team.tags.length ? <span className="ml-auto truncate">{team.tags.slice(0, 3).join(' · ')}</span> : null}
			</div>
		</Link>
	);
}

export function Component() {
	const { user } = useAuth();
	const api_fetch = useOrgFetch();
	const [params, set_params] = useSearchParams();
	const [teams, set_teams] = useState<TeamListItem[]>([]);
	const [total, set_total] = useState(0);
	const [loading, set_loading] = useState(true);
	const [failed, set_failed] = useState(false);

	const query = params.get('q') || '';
	const offset = Math.max(0, parseInt(params.get('offset') || '0', 10) || 0);
	const sort = params.get('sort') || 'popular';
	const tag = params.get('tag') || '';
	const [draft, set_draft] = useState(query);

	function set_param(key: string, value: string | null) {
		const next = new URLSearchParams(params);
		if (value) next.set(key, value); else next.delete(key);
		if (key !== 'offset') next.delete('offset');
		set_params(next, { replace: true });
	}

	// Debounced search, like Build › Teams.
	useEffect(() => {
		const t = setTimeout(() => { if (draft.trim() !== query) set_param('q', draft.trim() || null); }, 300);
		return () => clearTimeout(t);
	}, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		set_loading(true);
		set_failed(false);
		const body: Record<string, unknown> = { limit: PAGE_SIZE, offset, ...(CATALOG_SORT_BODY[sort] ?? {}) };
		if (query) body.query = query;
		if (tag) body.tag = tag;
		api_fetch('/v1/teams/get', { method: 'POST', body: JSON.stringify(body) })
			.then((res) => res.json())
			.then((data) => {
				if (!data.ok) { set_failed(true); return; }
				const d = data.data as BffTeamListResponse;
				set_teams(d.teams);
				set_total(d.total);
			})
			.catch(() => set_failed(true))
			.finally(() => set_loading(false));
	}, [api_fetch, query, offset, sort, tag]);

	const href = (t: TeamListItem) => (user ? team_href(t.scope, t.name) : `/browse/${encodeURIComponent(t.scope || '_')}/${encodeURIComponent(t.name)}`);
	const from = total ? offset + 1 : 0;
	const to = Math.min(offset + PAGE_SIZE, total);
	const filtered = Boolean(query || tag);

	return (
		<div className={`flex flex-col gap-4 py-6 ${user ? 'px-7' : 'mx-auto w-full max-w-6xl px-6'}`}>
			<div>
				<h1 className="text-[22px] font-semibold tracking-tight">Marketplace</h1>
				<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">Teams people have published for anyone to install. Open one to see its workflow, then install it into a realm{user ? '' : ' after you sign in'}.</p>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<label className="relative w-full sm:w-auto">
					<span className="sr-only">Search teams</span>
					<Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--g-ink-3)]" />
					<input
						value={draft}
						onChange={(e) => set_draft(e.target.value)}
						placeholder="Search teams…"
						className="h-8 w-full rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] pl-8 sm:w-[280px] pr-2.5 text-[12.5px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]"
					/>
				</label>
				<div role="group" aria-label="Sort" className="flex flex-wrap gap-2 sm:ml-2">
					{SORTS.map((s) => (
						<button key={s.id} type="button" aria-pressed={sort === s.id} onClick={() => set_param('sort', s.id === 'popular' ? null : s.id)} className={PILL(sort === s.id)}>{s.label}</button>
					))}
				</div>
				<span className="ml-auto text-[12px] text-[var(--g-ink-3)]" aria-live="polite">{loading ? '…' : `${total.toLocaleString()} team${total === 1 ? '' : 's'}`}</span>
			</div>

			<div role="group" aria-label="Tags" className="flex flex-wrap items-center gap-1.5">
				<span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Tags</span>
				{POPULAR_TAGS.map((t) => (
					<button key={t} type="button" aria-pressed={tag === t} onClick={() => set_param('tag', tag === t ? null : t)} className={TAG(tag === t)}>{t}</button>
				))}
			</div>

			{failed ? (
				<div role="alert" className="rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] px-4 py-3 text-[13px] text-[var(--g-bad)]">Could not load the marketplace. Try again in a moment.</div>
			) : loading && !teams.length ? (
				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading teams">
					{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[150px] animate-pulse rounded-[12px] border border-[var(--g-line)] bg-[var(--g-panel)]" />)}
				</div>
			) : teams.length ? (
				<div className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-3 ${loading ? 'opacity-60' : ''}`}>
					{teams.map((t) => <Market_card key={`${t.scope || ''}/${t.name}`} team={t} href={href(t)} />)}
				</div>
			) : (
				<div className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-12 text-center text-[13px] text-[var(--g-ink-3)]">
					{filtered ? 'No teams match these filters.' : 'No teams have been published yet.'}
					{user ? <> <Link to="/builder" className="text-[var(--g-acc)] hover:underline">Build one</Link>.</> : null}
				</div>
			)}

			{total > PAGE_SIZE ? (
				<div className="flex items-center justify-end gap-2 text-[12px] text-[var(--g-ink-3)]">
					<span>{from}–{to} of {total.toLocaleString()}</span>
					<button type="button" aria-label="Previous page" disabled={offset === 0} onClick={() => set_param('offset', offset - PAGE_SIZE > 0 ? String(offset - PAGE_SIZE) : null)} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] disabled:opacity-40">‹</button>
					<button type="button" aria-label="Next page" disabled={to >= total} onClick={() => set_param('offset', String(offset + PAGE_SIZE))} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] disabled:opacity-40">›</button>
				</div>
			) : null}
		</div>
	);
}
