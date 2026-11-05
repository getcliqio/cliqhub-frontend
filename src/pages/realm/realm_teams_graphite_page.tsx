/**
 * Realm › Teams (Graphite). Read: one `POST /v1/realm_teams/get` per page
 * (BFF: realm gate, Core's realm team list, latest versions).
 * A row is the team, the realm's version ("↑ newer" when a later one is published), its description and Run;
 * clicking it opens the team's page in this realm, which has the rest (when to use it, its inputs, its sub-team
 * tree, Change version, Uninstall). A team on a daemon but not on the realm's list can be added: `/v1/realms/add_team`.
 * "Install a team" searches the realm's org's Teams list (`/v1/team_list/get`, All): a realm installs
 * only from it (PLAN-team-visibility §3.4).
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { AlertTriangle, Play, Plus, RefreshCw, Search, X } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { use_overview, relative_time } from '@/lib/overview';
import { api_message, use_bff_read } from '@/lib/use_bff_read';
import { realm_path } from '@/lib/realm_url';
import { type Realm_team_row, type Realm_teams_data } from '@/lib/realm_teams';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { use_access } from '@/lib/access';
import { Sort_th, use_table_sort } from '@/components/graphite/g_sort';
import { Realm_nav } from '@/components/graphite/realm_nav';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { Run_in_realm_dialog } from '@/components/run_in_realm_dialog';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';
import { ROW_OPENS, use_row_open } from '@/components/graphite/g_row';

export const TEAMS_PAGE_SIZE = 25;

const INPUT = 'h-8 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[12.5px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]';
/** Greyed out when your role doesn't allow it (the reason is the tooltip). */
const GATED = 'disabled:cursor-not-allowed disabled:opacity-45';
const PRIMARY = 'inline-flex items-center gap-1.5 rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:opacity-50';

function use_post() {
	const auth_fetch = useAuthFetch();
	return async (path: string, body: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> => {
		try {
			const res = await auth_fetch(path, { method: 'POST', body: JSON.stringify(body) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) return { ok: false, error: api_message(payload, 'Request failed') };
			return { ok: true, data: payload.data ?? payload };
		} catch {
			return { ok: false, error: 'Network error — check your connection.' };
		}
	};
}

/** Install into this realm from its org's Teams list (PLAN-team-visibility §3.4): search it, add one. */
function Install_drawer({ realm_id, org_id, org_slug, installed, on_close, on_installed }: { realm_id: string; org_id: string | null; org_slug: string; installed: Set<string>; on_close: () => void; on_installed: () => Promise<void> }) {
	const auth_fetch = useAuthFetch();
	const post = use_post();
	const [q, set_q] = useState('');
	const [rows, set_rows] = useState<Array<{ id: string | null; name: string; scope: string | null; description: string; latest_version: string }>>([]);
	const [total, set_total] = useState(0);
	const [loading, set_loading] = useState(false);
	const [busy, set_busy] = useState<string | null>(null);
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const seq = useRef(0);

	async function load(query: string, offset: number) {
		if (!org_id) return;
		const my = ++seq.current;
		set_loading(true);
		try {
			const res = await auth_fetch('/v1/team_list/get', { method: 'POST', body: JSON.stringify({ org_id, scope: org_slug, status: 'all', ...(query ? { q: query } : {}), limit: 20, offset }) });
			const payload = await res.json().catch(() => null);
			if (my !== seq.current) return;
			const d = payload?.data ?? payload ?? {};
			const items = (d.teams ?? d.items ?? []) as typeof rows;
			set_rows((cur) => (offset ? [...cur, ...items] : items));
			set_total(Number(d.total ?? items.length));
		} catch {
			if (my === seq.current) set_msg({ tone: 'bad', text: 'Couldn’t search teams.' });
		} finally {
			if (my === seq.current) set_loading(false);
		}
	}
	useEffect(() => { const t = setTimeout(() => void load(q.trim(), 0), q ? 250 : 0); return () => clearTimeout(t); }, [q, org_id]); // eslint-disable-line react-hooks/exhaustive-deps

	async function install(team_id: string, scope: string, name: string) {
		const key = `${scope}/${name}`;
		set_busy(key);
		set_msg(null);
		const res = await post('/v1/realms/add_team', { realm_id, team_id });
		set_busy(null);
		if (!res.ok) { set_msg({ tone: 'bad', text: res.error }); return; }
		set_msg({ tone: 'ok', text: `@${key} added at its latest version. Online daemons install it now; others when they connect.` });
		await on_installed();
	}

	return (
		<div className="fixed inset-0 z-50 flex justify-end bg-[var(--g-backdrop)]" role="dialog" aria-label="Install a team" onMouseDown={(e) => { if (e.target === e.currentTarget) on_close(); }}>
			<div className="flex h-full w-[560px] max-w-full flex-col gap-4 overflow-y-auto border-l border-[var(--g-line-strong)] bg-[var(--g-panel)] px-7 py-6 shadow-[var(--g-drawer-shadow)]">
				<div className="flex items-center">
					<h2 className="text-[18px] font-semibold">Install a team</h2>
					<button type="button" onClick={on_close} aria-label="Close" className="ml-auto text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><X className="h-4 w-4" /></button>
				</div>
				<p className="text-[12.5px] text-[var(--g-ink-3)]">Teams on @{org_slug}’s Teams list: its own, cliq’s and those it added. Adding one puts it on this realm’s team list and installs it on the realm’s online daemons. Another org’s team goes on the <Link to={`/teams?org=${encodeURIComponent(org_slug)}`} className="text-[var(--g-acc)] hover:underline">Teams list</Link> first.</p>
				<div className="flex items-center gap-2 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5">
					<Search aria-hidden className="h-3.5 w-3.5 text-[var(--g-ink-3)]" />
					<input autoFocus aria-label="Search teams to install" value={q} onChange={(e) => set_q(e.target.value)} placeholder="Search by name or description…" className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-[var(--g-ink)] outline-none" />
				</div>
				{msg ? <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`text-[12.5px] ${msg.tone === 'bad' ? 'text-[var(--g-bad)]' : 'text-[var(--g-ok)]'}`}>{msg.text}</p> : null}
				<ul className="flex flex-col divide-y divide-[var(--g-line-2)] rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-label="Teams">
					{rows.map((t) => {
						const key = `${t.scope}/${t.name}`;
						const have = installed.has(key);
						return (
							<li key={key} className="flex items-start gap-3 px-4 py-3">
								<div className="min-w-0 flex-1">
									<p className="truncate text-[13px] font-semibold">@{key} <span className="g-mono text-[11px] font-normal text-[var(--g-ink-3)]">{t.latest_version}</span></p>
									{t.description ? <p className="mt-0.5 line-clamp-2 text-[12px] text-[var(--g-ink-3)]">{t.description}</p> : null}
								</div>
								{have
									? <span className="shrink-0 text-[12px] text-[var(--g-ink-3)]">In this realm</span>
									: <button type="button" disabled={!t.id || !t.scope || busy === key} onClick={() => t.id && t.scope && void install(t.id, t.scope, t.name)} className={ROW_ACTION_CLS}>{busy === key ? 'Adding…' : 'Add to realm'}</button>}
							</li>
						);
					})}
					{!loading && rows.length === 0 ? <li className="px-4 py-6 text-center text-[12.5px] text-[var(--g-ink-3)]">{q ? 'No teams match.' : 'No teams on the Teams list yet.'}</li> : null}
				</ul>
				{rows.length < total ? (
					<button type="button" disabled={loading} onClick={() => void load(q.trim(), rows.length)} className="self-start text-[12.5px] font-semibold text-[var(--g-acc)] hover:underline disabled:opacity-50">{loading ? 'Loading…' : `Show more (${total - rows.length} left)`}</button>
				) : null}
			</div>
		</div>
	);
}

export function Component() {
	const row = use_row_open();
	const { org = '', slug = '' } = useParams();
	const overview = use_overview();
	const access = use_access(overview.data);
	const post = use_post();
	const [search, set_search] = useSearchParams();
	const q = search.get('q') ?? '';
	const page = Math.max(0, Number(search.get('page') ?? 0) || 0);
	/** Top-level (the default: the teams no other team here calls) or All; a search always covers all. */
	const show: 'teams' | 'all' = search.get('show') === 'all' ? 'all' : 'teams';
	const [draft, set_draft] = useState(q);
	const [running, set_running] = useState<Realm_team_row | null>(null);
	const [installing, set_installing] = useState(() => search.get('install') === '1');
	const [busy, set_busy] = useState<string | null>(null);
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const base = realm_path(org, slug);

	const set_param = (k: string, v: string | null, keep_page = false) => set_search((prev) => {
		const p = new URLSearchParams(prev);
		if (v === null || v === '') p.delete(k); else p.set(k, v);
		if (!keep_page) p.delete('page');
		return p;
	}, { replace: true });
	useEffect(() => { const t = setTimeout(() => { if (draft.trim() !== q) set_param('q', draft.trim() || null); }, 300); return () => clearTimeout(t); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

	// Sorted by the BFF (or by Core on a search), so it is right across pages; default = team name.
	const sort = use_table_sort({ keys: ['team', 'origin'], default_sort: { by: 'team', dir: 'asc' } });
	const read = use_bff_read<Realm_teams_data>(
		'/v1/realm_teams/get',
		org && slug ? { org_slug: org, slug, limit: TEAMS_PAGE_SIZE, offset: page * TEAMS_PAGE_SIZE, ...(q ? { q } : {}), ...(show === 'all' ? { show } : {}), ...sort.body } : null,
		{ refresh_ms: 30_000, fallback_error: 'Could not load teams.' },
	);
	const data = read.data;
	const cols = sort.with_sortable(data?.sortable);
	const realm_id = data?.realm.id ?? null;
	const manage = access.realm(realm_id, 'operate', 'realms.teams.manage');
	const runnable = access.realm(realm_id, 'operate', 'teams.run');
	const sidebar_realm = overview.data?.orgs.flatMap((o) => o.realms).find((r) => r.id === realm_id) ?? null;
	const from = data && data.total ? data.offset + 1 : 0;
	const to = data ? Math.min(data.offset + data.limit, data.total) : 0;
	/** Recently run (the BFF's, first page only): above the rest, not repeated in it. */
	const recent = data && page === 0 && !q ? data.recent ?? [] : [];

	/** One team: name · version (and update badges), description, warnings; Sub-team; Last run; Run. */
	const team_row = (r: Realm_team_row) => (
									<tr key={r.label} {...row({ to: r.scope ? `${base}/teams/${encodeURIComponent(r.scope)}/${encodeURIComponent(r.slug)}${r.version ? `?v=${encodeURIComponent(r.version)}` : ''}` : null })} className={`border-b border-[var(--g-line-2)] last:border-b-0 ${r.scope ? ROW_OPENS : ''}`} data-testid={`team-${r.label}`}>
										<td className="max-w-[520px] px-4 py-2.5">
											{/* The team with the realm's version, e.g. @cliq/hello-world · 2.0.0 (↑ newer published). */}
											<span className="flex min-w-0 items-center gap-1.5">
												{r.scope ? <Link to={`${base}/teams/${encodeURIComponent(r.scope)}/${encodeURIComponent(r.slug)}${r.version ? `?v=${encodeURIComponent(r.version)}` : ''}`} className="truncate text-[13px] font-semibold hover:underline">{r.label}</Link> : <span className="truncate text-[13px] font-semibold">{r.label}</span>}
												{r.version ? <span className="g-mono shrink-0 text-[12px] text-[var(--g-ink-3)]" data-testid="team-version">· {r.version}</span> : null}
												{r.update_available ? <span title="A newer version is published: change the version on the team's page" className="shrink-0 rounded-full bg-[var(--g-acc-soft)] px-2 py-0.5 text-[11px] text-[var(--g-acc)]" data-testid="update-badge">↑ {r.latest_version} available</span> : null}
												{r.sub_team_updates ? <span title="Newer versions of sub-teams it calls without a pinned version: re-install the team's version on its page to get them" className="shrink-0 rounded-full bg-[var(--g-soft)] px-2 py-0.5 text-[11px] text-[var(--g-ink-2,var(--g-ink))]" data-testid="sub-team-updates-badge">{r.sub_team_updates} sub-team update{r.sub_team_updates === 1 ? '' : 's'}</span> : null}
											</span>
											{r.description ? <span className="line-clamp-2 text-[12px] text-[var(--g-ink-2)]" data-testid="team-description">{r.description}</span> : null}
																				<span className="flex flex-wrap gap-2 text-[11px] text-[var(--g-ink-3)]">
												{r.origin === 'cli' ? <span>local install (not on Hub; nothing known about when to use it)</span> : null}
												{!r.in_team_list ? <span>on a daemon, not on the realm’s team list</span> : null}
												{r.missing_agents.length ? <span className="inline-flex items-center gap-1 text-[var(--g-warn-text)]"><AlertTriangle aria-hidden className="h-3 w-3" />needs agents: {r.missing_agents.join(', ')}</span> : null}
											</span>
										</td>
										{/* Called by another team in this realm: a dot, the callers on hover. */}
			<td className="px-4 py-2.5 text-center" data-testid="sub-team-cell">{r.used_by?.length ? <span role="img" aria-label={`Sub-team of ${r.used_by.join(', ')}`} title={`Run by ${r.used_by.join(', ')}`} className="inline-block h-2 w-2 rounded-full bg-[var(--g-ink-3)]" data-testid="sub-team-dot" /> : null}</td>
			<td className="whitespace-nowrap px-4 py-2.5 text-[var(--g-ink-2)]">{r.last_run_at ? relative_time(r.last_run_at) : 'never'}</td>
										<td className="px-4 py-2.5 text-right">
											{r.scope && r.in_team_list ? <button type="button" disabled={!runnable.ok} title={runnable.reason ?? undefined} onClick={(e) => { e.stopPropagation(); set_running(r); }} className={`${ROW_ACTION_CLS} ${GATED} inline-flex items-center gap-1`}><Play aria-hidden className="h-3 w-3" />Run</button> : null}
											{!r.in_team_list && r.team_id ? <button type="button" disabled={busy !== null || !manage.ok} title={manage.reason ?? undefined} onClick={(e) => { e.stopPropagation(); void add(r); }} className={`${ROW_ACTION_CLS} ${GATED}`}>Add to realm</button> : null}
										</td>
									</tr>
	);

	/** A team on a daemon but not on the realm's list: put it on the list. */
	async function add(row: Realm_team_row) {
		if (!realm_id || !row.team_id) return;
		set_busy(`add:${row.label}`);
		set_msg(null);
		const res = await post('/v1/realms/add_team', { realm_id, team_id: row.team_id });
		set_busy(null);
		if (!res.ok) { set_msg({ tone: 'bad', text: res.error }); return; }
		set_msg({ tone: 'ok', text: `${row.label} added to the realm.` });
		await read.reload();
	}

	return (
		<Graphite_shell
			data={overview.data}
			current_realm_id={realm_id}
			title="Teams"
			actions={
				<button type="button" onClick={() => void read.reload()} aria-label="Refresh" title="Refresh" className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">
					<RefreshCw className="h-3.5 w-3.5" />
				</button>
			}
		>
			<Realm_nav org_slug={org} slug={slug} realm={sidebar_realm}>
			<div className="flex flex-col gap-4">
				{read.status === 'error' && !data ? (
					<Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="realm" />
				) : (
					<>
						<div className="flex flex-wrap items-center gap-2">
							<input aria-label="Search teams" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Search by name or what you want to do…" className={`${INPUT} w-[300px]`} />
							{/* A search covers every team, so the switch only shows without one. */}
							{!q && data?.counts ? (
								<div role="group" aria-label="Which teams" className="flex overflow-hidden rounded-md border border-[var(--g-line-strong)] text-[12px]">
									{([['teams', 'Top-level', 'Teams people start: no other team here runs them, or they are also started directly'], ['all', 'All', 'Every team, sub-teams too']] as const).map(([k, text, hint]) => (
										<button key={k} type="button" aria-pressed={show === k} title={hint} onClick={() => set_param('show', k === 'all' ? 'all' : null)} className={`h-8 px-3 ${show === k ? 'bg-[var(--g-soft)] font-semibold text-[var(--g-ink)]' : 'text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>
											{text} <span className="font-normal text-[var(--g-ink-3)]">{data.counts![k]}</span>
										</button>
									))}
								</div>
							) : null}
							<button type="button" disabled={!realm_id || !manage.ok} title={manage.reason ?? undefined} onClick={() => set_installing(true)} className={`${PRIMARY} ${GATED} ml-auto`}><Plus aria-hidden className="h-3.5 w-3.5" />Install a team</button>
						</div>
						{msg ? <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`text-[12.5px] ${msg.tone === 'bad' ? 'text-[var(--g-bad)]' : 'text-[var(--g-ok)]'}`}>{msg.text}</p> : null}
						<div className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
							{read.status === 'loading' ? <div className="h-[360px] animate-pulse" aria-busy="true" aria-label="Loading teams" /> : null}
							{data && data.items.length === 0 && !recent.length ? (
								<p className="px-4 py-12 text-center text-[13px] text-[var(--g-ink-3)]">{q ? 'No teams match this search.' : 'No teams in this realm yet — install one to get started.'}</p>
							) : null}
							{data && (data.items.length || recent.length) ? (
								<table className="w-full text-left text-[12.5px]">
									<thead>
										<tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">
											<Sort_th sort={cols} k="team" className="px-4 py-2.5 font-semibold">Team</Sort_th>
											<th className="whitespace-nowrap px-4 py-2.5 text-center font-semibold" title="Run by another team in this realm">Is Sub Team</th>
											<th className="px-4 py-2.5 font-semibold">Last run</th>
											<th className="w-[140px] px-4 py-2.5" />
										</tr>
									</thead>
									<tbody>
										{recent.length ? <tr className="border-b border-[var(--g-line-2)] bg-[var(--g-soft)]"><th colSpan={4} scope="rowgroup" className="px-4 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]">Recently run</th></tr> : null}
										{recent.map(team_row)}
										{recent.length && data.items.length ? <tr className="border-b border-[var(--g-line-2)] bg-[var(--g-soft)]"><th colSpan={4} scope="rowgroup" className="px-4 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]">Everything else</th></tr> : null}
										{data.items.map(team_row)}
									</tbody>
								</table>
							) : null}
							{data && data.total > data.limit ? (
								<div className="flex items-center justify-end gap-2 border-t border-[var(--g-line)] px-4 py-2.5 text-[12px] text-[var(--g-ink-3)]">
									<span>{from}–{to} of {data.total}</span>
									<button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => set_param('page', page - 1 ? String(page - 1) : null, true)} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] disabled:opacity-40">‹</button>
									<button type="button" aria-label="Next page" disabled={to >= data.total} onClick={() => set_param('page', String(page + 1), true)} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] disabled:opacity-40">›</button>
								</div>
							) : null}
						</div>
					</>
				)}
			</div>
			{installing && realm_id ? (
				<Install_drawer realm_id={realm_id} org_id={sidebar_realm?.org_id ?? null} org_slug={org ?? ''} installed={new Set([...(data?.recent ?? []), ...(data?.items ?? [])].filter((r) => r.in_team_list && r.scope).map((r) => `${r.scope}/${r.slug}`))} on_close={() => set_installing(false)} on_installed={() => read.reload()} />
			) : null}
			{running && running.scope && data ? (
				<Run_in_realm_dialog scope={running.scope} slug={running.slug} fixed_realm={{ id: data.realm.id, slug: data.realm.slug, name: data.realm.name, org_id: sidebar_realm?.org_id }} on_close={() => set_running(null)} />
			) : null}
			</Realm_nav>
		</Graphite_shell>
	);
}
