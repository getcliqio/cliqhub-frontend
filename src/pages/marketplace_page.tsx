/**
 * Marketplace (Graphite): every team you can see, to read, fork or install.
 *
 * Read: one `POST /v1/team_list/get { source: 'catalog' }` per view — the BFF
 * reads the whole catalog, filters (search, categories, publisher, verified,
 * workflow features, "can run now"), sorts, pages and counts the facets. The
 * install state is for one realm: the realm you are viewing, or the one picked
 * here. Everything lives in the URL so a filtered view can be shared.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BadgeCheck, GitFork, Search, X } from 'lucide-react';
import { use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { use_view_scope } from '@/lib/view_scope';
import { phase_kind, team_href, type Catalog_facets, type Catalog_has, type Team_list_data, type Team_list_row } from '@/lib/team_page';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Team_avatar } from '@/pages/teams/teams_graphite_page';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

export const MARKETPLACE_PAGE_SIZE = 24;

const SORTS = [
	{ id: 'popular', label: 'Most installed' },
	{ id: 'updated', label: 'Recently updated' },
	{ id: 'newest', label: 'Newest' },
	{ id: 'name', label: 'A–Z' },
] as const;
type Sort = (typeof SORTS)[number]['id'];

export const HAS_LABEL: Record<Catalog_has, string> = {
	human: 'Human review',
	gate: 'Test or check gate',
	team: 'Calls a sub-team',
	connector: 'Connector (Jira, Drive…)',
};
const HAS_ORDER: Catalog_has[] = ['human', 'gate', 'team', 'connector'];
const TAGS_SHOWN = 8;

const PILL = (on: boolean) => `inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] ${on ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] font-semibold text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;
const FACET_H = 'mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]';

/** Comma list in a URL param ↔ array. */
const list_param = (v: string | null) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

/** "6 days ago" for a unix-ms time; null when unknown. */
export function ago(ms: number | null, now = Date.now()): string | null {
	if (!ms) return null;
	const s = Math.max(0, Math.round((now - ms) / 1000));
	if (s < 60) return 'just now';
	const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
	const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
	const d = Math.round(h / 24); if (d < 31) return `${d} day${d === 1 ? '' : 's'} ago`;
	const mo = Math.round(d / 30); if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
	const y = Math.round(mo / 12); return `${y} year${y === 1 ? '' : 's'} ago`;
}

/** The team's workflow as a strip of segments, one per phase, coloured by kind. */
export function Phase_bar({ kinds }: { kinds: string[] }) {
	if (!kinds.length) return <div className="h-1.5 rounded-full bg-[var(--g-soft)]" aria-label="No phases yet" />;
	const labels = kinds.map((k) => phase_kind(k).label);
	return (
		<div className="flex h-1.5 gap-[3px]" role="img" aria-label={`${kinds.length} phases: ${labels.join(', ')}`} title={labels.join(' → ')}>
			{kinds.map((k, i) => <i key={i} className="block h-full flex-1 rounded-full" style={{ background: phase_kind(k).color }} />)}
		</div>
	);
}

function Install_badge({ row, realm_slug }: { row: Team_list_row; realm_slug: string | null }) {
	const inst = row.installs[0];
	const orgs = row.catalog?.in_orgs ?? [];
	if (!inst || !realm_slug) {
		return orgs.length ? <span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--g-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--g-ink-2)]" title={`In ${orgs.join(', ')}’s teams`}>In {orgs[0]}{orgs.length > 1 ? ` +${orgs.length - 1}` : ''}</span> : null;
	}
	if (inst.behind && row.latest_version) {
		return <span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--g-warn-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--g-warn-text)]" title={`${realm_slug} runs ${inst.version ?? 'an older version'}`}>{row.latest_version} available</span>;
	}
	return <span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--g-ok-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--g-ok)]" title={`Installed in ${realm_slug}`}>In {realm_slug}</span>;
}

function Team_card({ row, realm_slug, org_q }: { row: Team_list_row; realm_slug: string | null; org_q: string }) {
	const c = row.catalog;
	const kinds = row.phase_kinds ?? [];
	const updated = ago(c?.updated_at ?? null);
	const meta = [
		`${kinds.length} phase${kinds.length === 1 ? '' : 's'}`,
		c ? `${c.version_count} version${c.version_count === 1 ? '' : 's'}` : null,
		c && c.install_count ? `${c.install_count} install${c.install_count === 1 ? '' : 's'}` : null,
	].filter(Boolean).join(' · ');
	return (
		<Link
			to={`${team_href(row.scope, row.name)}${org_q}`}
			data-testid={`market-${row.scope}/${row.name}`}
			className="group flex min-w-0 flex-col gap-3 rounded-[12px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4 outline-none transition-colors hover:border-[var(--g-line-strong,#3a3d44)] hover:bg-[var(--g-soft)] focus-visible:border-[var(--g-acc-line)]"
		>
			<div className="flex items-start gap-3">
				<Team_avatar name={row.name} size={40} />
				<div className="min-w-0 flex-1">
					<div className="flex items-start gap-2">
						<span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--g-ink)] group-hover:underline">{row.name}</span>
						<Install_badge row={row} realm_slug={realm_slug} />
					</div>
					<div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[var(--g-ink-3)]">
						<span className="g-mono truncate">@{row.scope ?? '—'}</span>
						{c?.verified ? <span className="inline-flex items-center gap-1 text-[var(--g-acc)]"><BadgeCheck aria-hidden className="h-3.5 w-3.5" />verified</span> : null}
					</div>
				</div>
			</div>
			<p className="line-clamp-2 min-h-[38px] text-[12.5px] leading-[19px] text-[var(--g-ink-2)]">{row.description || 'No description yet.'}</p>
			<Phase_bar kinds={kinds} />
			<div className="flex items-center gap-2 text-[11.5px] text-[var(--g-ink-3)]">
				<span className="truncate">{meta}</span>
				{c && c.fork_count ? <span className="inline-flex items-center gap-1" title={`${c.fork_count} fork${c.fork_count === 1 ? '' : 's'}`}><GitFork aria-hidden className="h-3 w-3" />{c.fork_count}</span> : null}
				<span className="ml-auto whitespace-nowrap">{row.latest_version ? <span className="g-mono">v{row.latest_version}</span> : null}{updated ? ` · ${updated}` : ''}</span>
			</div>
		</Link>
	);
}

function Check_row({ checked, label, count, on_change, children }: { checked: boolean; label: string; count?: number | null; on_change: (v: boolean) => void; children?: React.ReactNode }) {
	return (
		<label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-[13px] text-[var(--g-ink-2)] hover:text-[var(--g-ink)]">
			<input type="checkbox" checked={checked} onChange={(e) => on_change(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--g-acc)]" />
			<span className="min-w-0 flex-1 truncate">{children ?? label}</span>
			{count != null ? <span className="g-mono text-[11.5px] text-[var(--g-ink-3)]">{count}</span> : null}
		</label>
	);
}

function Facets({
	facets, tags, publisher, verified, has, runnable, realm_slug, set,
}: {
	facets: Catalog_facets | null;
	tags: string[];
	publisher: string | null;
	verified: boolean;
	has: Catalog_has[];
	runnable: boolean;
	realm_slug: string | null;
	set: (k: string, v: string | null) => void;
}) {
	const [all_tags, set_all_tags] = useState(false);
	const tag_rows = facets?.tags ?? [];
	const shown_tags = all_tags ? tag_rows : tag_rows.slice(0, TAGS_SHOWN);
	const toggle = (list: string[], v: string, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));
	return (
		<aside aria-label="Filters" className="flex w-[232px] shrink-0 flex-col gap-6 max-lg:w-full">
			{tag_rows.length ? (
				<section>
					<h2 className={FACET_H}>Category</h2>
					{shown_tags.map((t) => <Check_row key={t.tag} checked={tags.includes(t.tag)} label={t.tag} count={t.count} on_change={(on) => set('tags', toggle(tags, t.tag, on).join(',') || null)} />)}
					{tag_rows.length > TAGS_SHOWN ? <button type="button" onClick={() => set_all_tags(!all_tags)} className="mt-1 px-1 text-[12px] text-[var(--g-acc)] hover:underline">{all_tags ? 'Show fewer' : `Show all ${tag_rows.length}`}</button> : null}
				</section>
			) : null}
			<section>
				<h2 className={FACET_H}>Publisher</h2>
				<Check_row checked={verified} label="Verified only" count={facets?.verified ?? null} on_change={(on) => set('verified', on ? '1' : null)}>
					<span className="inline-flex items-center gap-1.5">Verified only <BadgeCheck aria-hidden className="h-3.5 w-3.5 text-[var(--g-acc)]" /></span>
				</Check_row>
				{(facets?.publishers ?? []).slice(0, 8).map((p) => (
					<Check_row key={p.scope} checked={publisher === p.scope} label={`@${p.scope}`} count={p.count} on_change={(on) => set('publisher', on ? p.scope : null)}>
						<span className="g-mono">@{p.scope}</span>
					</Check_row>
				))}
			</section>
			<section>
				<h2 className={FACET_H}>Workflow has</h2>
				{HAS_ORDER.map((h) => <Check_row key={h} checked={has.includes(h)} label={HAS_LABEL[h]} count={facets?.has[h] ?? null} on_change={(on) => set('has', toggle(has, h, on).join(',') || null)} />)}
			</section>
			{realm_slug ? (
				<section>
					<h2 className={FACET_H}>Ready in {realm_slug}</h2>
					<Check_row checked={runnable} label="Only teams I can run now" count={facets?.runnable ?? null} on_change={(on) => set('runnable', on ? '1' : null)} />
					<p className="mt-1 px-1 text-[11.5px] leading-[17px] text-[var(--g-ink-3)]">Installed here, on an online daemon, with every agent set up.</p>
				</section>
			) : null}
		</aside>
	);
}

export function Component() {
	const overview = use_overview();
	const scope = use_view_scope(overview.data);
	const [search, set_search] = useSearchParams();
	const q = search.get('q') ?? '';
	const tags = list_param(search.get('tags'));
	const publisher = search.get('publisher');
	const verified = search.get('verified') === '1';
	const has = list_param(search.get('has')).filter((h): h is Catalog_has => (HAS_ORDER as string[]).includes(h));
	const runnable = search.get('runnable') === '1';
	const sort = ((v) => (SORTS.some((s) => s.id === v) ? v : 'popular'))(search.get('sort')) as Sort;
	const page = Math.max(0, Number(search.get('page') ?? 0) || 0);
	const [draft, set_draft] = useState(q);
	const search_ref = useRef<HTMLInputElement>(null);

	// Install state: the realm in view, else the one picked here, else the first realm you have.
	const realms = useMemo(() => (overview.data?.orgs ?? []).flatMap((o) => o.realms), [overview.data]);
	const realm = (scope.kind === 'realm' ? scope.realm : null)
		?? realms.find((r) => r.id === search.get('realm'))
		?? (scope.kind === 'org' ? scope.org.realms[0] : null)
		?? realms[0] ?? null;
	const org_q = scope.kind === 'org' ? `?org=${encodeURIComponent(scope.org.slug)}` : '';

	const set_param = (k: string, v: string | null, keep_page = false) => set_search((prev) => {
		const p = new URLSearchParams(prev);
		if (v === null || v === '') p.delete(k); else p.set(k, v);
		if (!keep_page) p.delete('page');
		return p;
	}, { replace: true });
	useEffect(() => { const t = setTimeout(() => { if (draft.trim() !== q) set_param('q', draft.trim() || null); }, 250); return () => clearTimeout(t); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
	// "/" focuses the search, as in most catalogs.
	useEffect(() => {
		const on = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (e.key === '/' && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))) { e.preventDefault(); search_ref.current?.focus(); }
		};
		document.addEventListener('keydown', on);
		return () => document.removeEventListener('keydown', on);
	}, []);

	const body = overview.data || overview.status === 'error' ? {
		source: 'catalog', sort_by: sort, limit: MARKETPLACE_PAGE_SIZE, offset: page * MARKETPLACE_PAGE_SIZE,
		...(q ? { q } : {}), ...(tags.length ? { tags } : {}), ...(publisher ? { scope: publisher } : {}),
		...(verified ? { verified: true } : {}), ...(has.length ? { has } : {}),
		...(realm ? { realm_id: realm.id } : {}), ...(realm && runnable ? { runnable: true } : {}),
	} : null;
	const read = use_bff_read<Team_list_data>('/v1/team_list/get', body, { refresh_ms: 120_000, fallback_error: 'Could not load the marketplace.' });
	const data = read.data;
	const filtered = Boolean(q || tags.length || publisher || verified || has.length || runnable);
	const clear = () => { set_draft(''); set_search(new URLSearchParams(realm && search.get('realm') ? { realm: realm.id } : {}), { replace: true }); };
	const chips: Array<{ key: string; label: string; off: () => void }> = [
		...(q ? [{ key: 'q', label: `“${q}”`, off: () => { set_draft(''); set_param('q', null); } }] : []),
		...tags.map((t) => ({ key: `tag-${t}`, label: t, off: () => set_param('tags', tags.filter((x) => x !== t).join(',') || null) })),
		...(publisher ? [{ key: 'pub', label: `@${publisher}`, off: () => set_param('publisher', null) }] : []),
		...(verified ? [{ key: 'ver', label: 'Verified', off: () => set_param('verified', null) }] : []),
		...has.map((h) => ({ key: `has-${h}`, label: HAS_LABEL[h], off: () => set_param('has', has.filter((x) => x !== h).join(',') || null) })),
		...(runnable && realm ? [{ key: 'run', label: `Runnable in ${realm.slug}`, off: () => set_param('runnable', null) }] : []),
	];
	const from = data && data.total ? data.offset + 1 : 0;
	const to = data ? Math.min(data.offset + data.limit, data.total) : 0;

	return (
		<Graphite_shell data={overview.data} title="Marketplace">
			<div className="flex flex-col gap-5 px-7 py-6 max-md:px-4">
				<section className="flex items-center gap-6 rounded-[14px] border border-[var(--g-acc-line)] bg-[linear-gradient(120deg,var(--g-acc-soft),transparent_70%)] px-6 py-5 max-lg:flex-col max-lg:items-stretch">
					<div className="shrink-0">
						<h1 className="text-[22px] font-semibold tracking-tight">Marketplace</h1>
						<p className="mt-1 max-w-[340px] text-[13px] text-[var(--g-ink-2)]">Ready-made teams you can use. Open one to see how it works, then add it to your org and a realm to run it — or fork it to change it.</p>
					</div>
					<label className="relative flex min-w-0 flex-1 items-center">
						<Search aria-hidden className="pointer-events-none absolute left-3.5 h-4 w-4 text-[var(--g-ink-3)]" />
						<input
							ref={search_ref}
							type="search"
							aria-label="Search teams"
							value={draft}
							onChange={(e) => set_draft(e.target.value)}
							placeholder={data?.counts.all ? `Search ${data.counts.all} teams — “tdd”, “jira”, “content review”…` : 'Search teams…'}
							className="h-11 w-full rounded-[10px] border border-[var(--g-line)] bg-[var(--g-bg)] pl-10 pr-12 text-[14px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]"
						/>
						<kbd aria-hidden className="g-mono pointer-events-none absolute right-3 rounded border border-[var(--g-line)] px-1.5 text-[11px] text-[var(--g-ink-3)]">/</kbd>
					</label>
				</section>

				{read.status === 'error' && !data ? (
					<Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="the marketplace" />
				) : (
					<div className="flex gap-7 max-lg:flex-col">
						<Facets facets={data?.facets ?? null} tags={tags} publisher={publisher} verified={verified} has={has} runnable={runnable} realm_slug={realm?.slug ?? null} set={set_param} />
						<div className="flex min-w-0 flex-1 flex-col gap-4">
							<div className="flex flex-wrap items-center gap-2">
								<div role="group" aria-label="Sort" className="flex flex-wrap gap-2">
									{SORTS.map((s) => <button key={s.id} type="button" aria-pressed={sort === s.id} onClick={() => set_param('sort', s.id === 'popular' ? null : s.id)} className={PILL(sort === s.id)}>{s.label}</button>)}
								</div>
								<div className="ml-auto flex items-center gap-3 text-[12.5px] text-[var(--g-ink-3)]">
									{realms.length > 1 && scope.kind !== 'realm' ? (
										<label className="flex items-center gap-1.5">
											<span>Install state in</span>
											<select aria-label="Realm for install state" value={realm?.id ?? ''} onChange={(e) => set_param('realm', e.target.value || null, true)} className="h-8 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2 text-[12.5px] text-[var(--g-ink)]">
												{realms.map((r) => <option key={r.id} value={r.id}>{r.org_slug}/{r.slug}</option>)}
											</select>
										</label>
									) : null}
									<span aria-live="polite">{data ? `${data.total} team${data.total === 1 ? '' : 's'}` : ''}</span>
								</div>
							</div>
							{chips.length ? (
								<div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
									{chips.map((c) => (
										<button key={c.key} type="button" onClick={c.off} aria-label={`Remove filter ${c.label}`} className="inline-flex h-7 items-center gap-1 rounded-full border border-[var(--g-line)] bg-[var(--g-soft)] px-2.5 text-[12px] text-[var(--g-ink-2)] hover:text-[var(--g-ink)]">
											{c.label}<X aria-hidden className="h-3 w-3" />
										</button>
									))}
									<button type="button" onClick={clear} className="ml-1 text-[12px] text-[var(--g-acc)] hover:underline">Clear all</button>
								</div>
							) : null}
							{read.status === 'loading' && !data ? (
								<div className="grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1" aria-busy="true" aria-label="Loading teams">
									{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[178px] animate-pulse rounded-[12px] border border-[var(--g-line)] bg-[var(--g-panel)]" />)}
								</div>
							) : null}
							{data && data.items.length === 0 ? (
								<div className="rounded-[12px] border border-dashed border-[var(--g-line)] px-6 py-14 text-center">
									{filtered ? (
										<>
											<p className="text-[14px] font-semibold">No teams match these filters</p>
											<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">Try fewer filters or a different search.</p>
											<button type="button" onClick={clear} className="mt-4 inline-flex h-8 items-center rounded-md border border-[var(--g-line)] px-3 text-[12.5px] font-semibold hover:bg-[var(--g-soft)]">Clear filters</button>
										</>
									) : (
										<>
											<p className="text-[14px] font-semibold">Nothing published yet</p>
											<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">Teams that you, your orgs or verified publishers share show up here.</p>
											<Link to="/builder" className="mt-4 inline-flex h-8 items-center rounded-md bg-[var(--g-acc)] px-3 text-[12.5px] font-semibold text-[var(--g-on-acc)]">Build a team</Link>
										</>
									)}
								</div>
							) : null}
							{data && data.items.length ? (
								<div className="grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1">
									{data.items.map((row) => <Team_card key={`${row.scope}/${row.name}`} row={row} realm_slug={realm?.slug ?? null} org_q={org_q} />)}
								</div>
							) : null}
							{data && data.total > data.limit ? (
								<nav aria-label="Pages" className="flex items-center justify-end gap-2 text-[12px] text-[var(--g-ink-3)]">
									<span>{from}–{to} of {data.total}</span>
									<button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => set_param('page', page - 1 ? String(page - 1) : null, true)} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] disabled:opacity-40">‹</button>
									<button type="button" aria-label="Next page" disabled={to >= data.total} onClick={() => set_param('page', String(page + 1), true)} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] disabled:opacity-40">›</button>
								</nav>
							) : null}
							<div className="flex flex-wrap items-center gap-4 border-t border-[var(--g-line)] pt-3 text-[11.5px] text-[var(--g-ink-3)]">
								<span>Phases:</span>
								{(['agent', 'gate', 'human', 'connector', 'script', 'team'] as const).map((k) => <span key={k} className="inline-flex items-center gap-1.5"><i className="block h-1.5 w-3 rounded-full" style={{ background: phase_kind(k).color }} />{phase_kind(k).label}</span>)}
							</div>
						</div>
					</div>
				)}
			</div>
		</Graphite_shell>
	);
}
