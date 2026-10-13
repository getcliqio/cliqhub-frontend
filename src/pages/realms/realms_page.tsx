/**
 * Realms (Graphite) — /realms[?org=slug&q=&sort=&dir=&page=&new=1] — the realms of the org you're in.
 * List: a table read from `realms/get` (Core, through the BFF) with `with_stats` — searched, sorted
 * and paged on the server (name, online daemons, active runs, members, created, updated). "Needs
 * you" comes from the overview already loaded on every page.
 * New realm (owners/admins) is a side panel over this list: ?new=1 (pages/realms/new_realm_page).
 */
import { New_realm_panel } from '@/pages/realms/new_realm_page';
import { Health_badge } from '@/components/graphite/realm_header';
import { realm_health } from '@/lib/realm_inbox';
import { useEffect, useMemo, useState } from 'react';
import { use_bff_read } from '@/lib/use_bff_read';
import { Sort_th, use_table_sort } from '@/components/graphite/g_sort';
import { ROW_OPENS, use_row_open } from '@/components/graphite/g_row';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { use_overview, relative_time, type Overview_org, type Overview_realm } from '@/lib/overview';
import { realm_path } from '@/lib/realm_url';
import { use_view_scope } from '@/lib/view_scope';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { useAuth } from '@/lib/auth_context';
import { Banner, Pill } from '@/components/graphite/g_admin';
import { G_INPUT, G_PRIMARY } from '@/components/graphite/g_agents';

export function slugify(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}
/** Older Core didn't send permissions: fall back to the role name. */
const can_create = (o: Overview_org) => (o.permissions ? o.permissions.includes('realms.create') : o.role === 'owner' || o.role === 'admin');

export const REALMS_PAGE_SIZE = 25;

/** One realm row from `realms/get` with `with_stats`. */
export interface Realm_row {
	id: string;
	slug: string;
	name: string;
	/** What the realm is for (Core API with realm descriptions). */
	description?: string | null;
	org_slug: string | null;
	created_at: number;
	updated_at: number;
	member_count?: number;
	online_daemons?: number;
	active_runs?: number;
	/** Teams on the realm whose workflow names an agent the org hasn't registered (with_stats; newer Core). */
	teams_missing_agents?: number;
}
interface Realm_page { items: Realm_row[]; total: number; offset: number; limit: number }

const TH = 'px-4 py-2.5 font-semibold';
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

/** The realms table: server-side search, sort and paging. */
function Realms_table({ org_id, realms_by_id, q, page, set }: {
	org_id: string;
	realms_by_id: Map<string, Overview_realm>;
	q: string;
	page: number;
	set: (k: string, v: string | null) => void;
}) {
	const row = use_row_open();
	const sort = use_table_sort({ keys: ['name', 'online_daemons', 'active_runs', 'members', 'created_at', 'updated_at'], default_sort: { by: 'name', dir: 'asc' }, first_dir: { online_daemons: 'desc', active_runs: 'desc', members: 'desc', created_at: 'desc', updated_at: 'desc' } });
	const cols = sort.with_sortable(['name', 'online_daemons', 'active_runs', 'members', 'created_at', 'updated_at']);
	const body = { org_id, with_stats: true, limit: REALMS_PAGE_SIZE, offset: page * REALMS_PAGE_SIZE, ...(q ? { query: q } : {}), ...sort.body };
	const read = use_bff_read<Realm_page>('/v1/realms/get', body, { refresh_ms: 60_000, fallback_error: 'Could not load realms.' });
	const data = read.data ? { ...read.data, items: read.data.items ?? [], total: read.data.total ?? 0, offset: read.data.offset ?? 0, limit: read.data.limit ?? REALMS_PAGE_SIZE } : null;
	if (read.status === 'error' && !data) return <Banner tone="bad">{read.error ?? 'Could not load realms.'}</Banner>;
	if (!data) return <div className="h-[240px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading realms" />;
	const from = data.total ? data.offset + 1 : 0;
	const to = Math.min(data.offset + data.limit, data.total);
	return (
		<div className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
			{data.items.length === 0 ? <p className="px-4 py-10 text-center text-[13px] text-[var(--g-ink-3)]">{q ? `No realms match “${q}”.` : 'No realms yet.'}</p> : (
				<table className="w-full text-left text-[12.5px]" data-testid="realms-table">
					<thead><tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">
						<Sort_th sort={cols} k="name" className={TH}>Realm</Sort_th>
						<th className={TH}>Status</th>
						<Sort_th sort={cols} k="online_daemons" className={TH}>Online daemons</Sort_th>
						<Sort_th sort={cols} k="active_runs" className={TH}>Runs</Sort_th>
						<Sort_th sort={cols} k="members" className={TH}>Members</Sort_th>
						<Sort_th sort={cols} k="created_at" className={TH}>Created</Sort_th>
						<Sort_th sort={cols} k="updated_at" className={TH}>Updated</Sort_th>
					</tr></thead>
					<tbody>
						{data.items.map((r) => {
							const ov = realms_by_id.get(r.id);
							const href = r.org_slug ? `${realm_path(r.org_slug, r.slug)}/inbox` : null;
							const online = r.online_daemons ?? 0;
							const no_daemon = ov ? ov.daemons.total === 0 : false;
							return (
								<tr key={r.id} {...row({ to: href })} className={`border-b border-[var(--g-line-2)] last:border-b-0 ${href ? ROW_OPENS : ''}`} data-testid={`realm-${r.slug}`}>
									<td className="px-4 py-2.5">
										{href ? <Link to={href} onClick={(e) => e.stopPropagation()} className="font-semibold text-[var(--g-ink)] hover:underline">{r.name || r.slug}</Link> : <b>{r.name || r.slug}</b>}
										<span className="g-mono ml-2 text-[11.5px] text-[var(--g-ink-3)]">{r.slug}</span>
										{r.description ? <span className="block max-w-[420px] truncate text-[12px] text-[var(--g-ink-3)]" title={r.description}>{r.description}</span> : null}
									</td>
									<td className="px-4 py-2.5" data-testid="status">
										{online === 0 || r.teams_missing_agents !== undefined
											? <Health_badge health={realm_health(online, r.teams_missing_agents ?? 0)} />
											: <span className="text-[12px] text-[var(--g-ink-3)]">Online</span>}
									</td>
									<td className="px-4 py-2.5">
										<span className="inline-flex items-center gap-2">
											<i aria-hidden className={`h-2 w-2 rounded-full ${online ? 'animate-pulse bg-[var(--g-ok)]' : no_daemon ? 'bg-[var(--g-line-strong)]' : 'bg-[var(--g-bad)]'}`} />
											<b className="g-mono text-[13px]">{online}</b>
											{no_daemon ? <span className="text-[11.5px] text-[var(--g-ink-3)]">no daemon yet</span> : null}
										</span>
									</td>
									<td className="px-4 py-2.5">
										{r.active_runs ? <Pill tone="run">{r.active_runs} running</Pill> : <span className="text-[var(--g-ink-3)]">idle</span>}
										{ov?.needs_you ? <> <Pill tone="warn">{ov.needs_you} need you</Pill></> : null}
									</td>
									<td className="g-mono px-4 py-2.5">{r.member_count ?? '—'}</td>
									<td className="px-4 py-2.5 text-[var(--g-ink-3)]" title={new Date(r.created_at).toLocaleString()}>{day(r.created_at)}</td>
									<td className="px-4 py-2.5 text-[var(--g-ink-3)]" title={new Date(r.updated_at).toLocaleString()}>{relative_time(r.updated_at)}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			)}
			{data.total > data.limit ? (
				<div className="flex items-center justify-end gap-2 border-t border-[var(--g-line)] px-4 py-2.5 text-[12px] text-[var(--g-ink-3)]" data-testid="realms-pager">
					<span>{from}–{to} of {data.total}</span>
					<button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => set('page', page - 1 ? String(page - 1) : null)} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] disabled:opacity-40">‹</button>
					<button type="button" aria-label="Next page" disabled={to >= data.total} onClick={() => set('page', String(page + 1))} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] disabled:opacity-40">›</button>
				</div>
			) : null}
		</div>
	);
}

export function Component() {
	const overview = use_overview();
	const scope = use_view_scope(overview.data);
	const [sp, set_sp] = useSearchParams();
	const org = scope.org;
	const q = (sp.get('q') ?? '').trim();
	const page = Math.max(0, Number(sp.get('page') ?? 0) || 0);
	const [draft, set_draft] = useState(sp.get('q') ?? '');
	const navigate = useNavigate();
	// New realm is a side panel over this list (?new=1, so Back closes it).
	const creating = sp.get('new') === '1';
	const open_new = () => set_sp((prev) => { const p = new URLSearchParams(prev); p.set('new', '1'); return p; });
	const close_new = () => set_sp((prev) => { const p = new URLSearchParams(prev); p.delete('new'); return p; }, { replace: true });
	const joined = sp.get('joined');
	const joined_realm = joined ? (org?.realms ?? []).find((r) => r.slug === joined) ?? null : null;
	const { user } = useAuth();
	const may_create = Boolean(org && (user?.role === 'admin' || can_create(org)));
	const set = (k: string, v: string | null) => set_sp((prev) => { const p = new URLSearchParams(prev); if (v) p.set(k, v); else p.delete(k); if (k !== 'page') p.delete('page'); return p; }, { replace: true });
	// Search is on the server: the URL follows what you type after a short pause.
	useEffect(() => { const t = setTimeout(() => { if (draft.trim() !== q) set('q', draft.trim() || null); }, 300); return () => clearTimeout(t); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
	const realms_by_id = useMemo(() => new Map((org?.realms ?? []).map((r) => [r.id, r])), [org]);
	const total = org?.realms.length ?? 0;
	return (
		<Graphite_shell data={overview.data} title="Realms">
			<div className="flex flex-col gap-4 px-7 py-6">
				<header className="flex flex-wrap items-center gap-3">
					<div><h1 className="text-[22px] font-semibold tracking-tight">Realms</h1><p className="mt-1 text-[13px] text-[var(--g-ink-3)]">Groups of machines that run your teams. {total} realm{total === 1 ? '' : 's'} in {org?.display_name || org?.slug || 'this organization'}.</p></div>
					{org ? (
						<button type="button" disabled={!may_create} title={may_create ? undefined : `Your role in ${org.display_name || org.slug} doesn't allow creating realms`} onClick={open_new} className={`${G_PRIMARY} ml-auto disabled:cursor-not-allowed disabled:opacity-45`}><Plus className="h-3.5 w-3.5" /> New realm</button>
					) : null}
				</header>
				{joined_realm ? <Banner tone="ok">You joined {joined_realm.name || joined_realm.slug}. <Link to={`${realm_path(joined_realm.org_slug, joined_realm.slug)}/inbox`} className="font-semibold underline">Open it →</Link></Banner> : null}
				<div className="flex flex-wrap items-center gap-2">
					<label className="relative ml-auto"><Search aria-hidden className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--g-ink-3)]" /><input aria-label="Search realms" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Search realms" className={`${G_INPUT} w-[220px] pl-8`} /></label>
				</div>
				{!overview.data ? <div className="h-[240px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading realms" /> : null}
				{org && org.status !== 'error' ? <Realms_table org_id={org.id} realms_by_id={realms_by_id} q={q} page={page} set={set} /> : null}
				{org?.status === 'error' ? <Banner tone="bad">{org.error ?? 'Could not load this organization’s realms.'}</Banner> : null}
				{org && !total ? (
					<p className="rounded-[10px] border border-dashed border-[var(--g-line)] px-4 py-6 text-center text-[12.5px] text-[var(--g-ink-3)]">No realms yet.{may_create ? <> <button type="button" onClick={open_new} className="text-[var(--g-acc)] hover:underline">Create one</button></> : ' Ask an org admin to add you to one.'}</p>
				) : null}
			</div>
			{creating && org && may_create ? <New_realm_panel org={org} on_close={close_new} /> : null}
		</Graphite_shell>
	);
}
