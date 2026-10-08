/**
 * Realm › Teams (Graphite). Read: one `POST /v1/realm_teams/get` per page
 * (BFF: realm gate, Core's realm coverage list, chip counts, latest versions).
 * Writes are single Core routes: `/v1/realms/add_team` (add, update/re-sync —
 * Core installs on the realm's online daemons) and `/v1/realms/remove_team`.
 * The catalog search in "Install a team" is the existing `/v1/teams/get`, published teams only
 * (`@scope/name` or any part of the name, description or scope).
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { AlertTriangle, MoreHorizontal, Play, Plus, RefreshCw, Search, X } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { use_overview, relative_time } from '@/lib/overview';
import { api_message, use_bff_read } from '@/lib/use_bff_read';
import { realm_path } from '@/lib/realm_url';
import { coverage_text, type Coverage_filter, type Realm_team_row, type Realm_teams_data } from '@/lib/realm_teams';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { use_access, type Gate } from '@/lib/access';
import { Sort_th, use_table_sort } from '@/components/graphite/g_sort';
import { Realm_nav } from '@/components/graphite/realm_nav';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { Run_in_realm_dialog } from '@/components/run_in_realm_dialog';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';
import { ROW_OPENS, Row_open, use_row_open } from '@/components/graphite/g_row';

export const TEAMS_PAGE_SIZE = 25;

const PILL = (on: boolean) => `inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] ${on ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;
const INPUT = 'h-8 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[12.5px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]';
/** Greyed out when your role doesn't allow it (the reason is the tooltip). */
const GATED = 'disabled:cursor-not-allowed disabled:opacity-45';
const PRIMARY = 'inline-flex items-center gap-1.5 rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:opacity-50';

const CHIPS: Array<{ id: Coverage_filter | null; label: string; count: keyof Realm_teams_data['counts'] }> = [
	{ id: null, label: 'All', count: 'all' },
	{ id: 'full', label: 'On every daemon', count: 'full' },
	{ id: 'partial', label: 'On some daemons', count: 'partial' },
	{ id: 'none', label: 'Not installed', count: 'none' },
];

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

/** Row ⋯ menu. */
function Row_menu({ row, base, on_remove, on_add, manage }: { row: Realm_team_row; base: string; on_remove: () => void; on_add: () => void; manage: Gate }) {
	const [open, set_open] = useState(false);
	const ref = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (!open) return;
		const on_down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) set_open(false); };
		document.addEventListener('mousedown', on_down);
		return () => document.removeEventListener('mousedown', on_down);
	}, [open]);
	const item = 'block w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--g-soft)]';
	return (
		<div className="relative inline-block" ref={ref}>
			<button type="button" aria-label={`More for ${row.label}`} aria-expanded={open} onClick={() => set_open((v) => !v)} className="grid h-7 w-7 place-items-center rounded-md text-[var(--g-ink-3)] hover:bg-[var(--g-soft)] hover:text-[var(--g-ink)]">
				<MoreHorizontal className="h-4 w-4" />
			</button>
			{open ? (
				<div role="menu" className="absolute right-0 top-8 z-40 w-[200px] overflow-hidden rounded-lg border border-[var(--g-line-strong)] bg-[var(--g-pop)] py-1 shadow-[var(--g-pop-shadow)]">
					{row.scope ? <Link role="menuitem" to={`${base}/teams/${encodeURIComponent(row.scope)}/${encodeURIComponent(row.slug)}`} className={item}>View team</Link> : null}
					<Link role="menuitem" to={`${base}/runs?team=${encodeURIComponent(row.scope ? `${row.scope}/${row.slug}` : row.slug)}`} className={item}>Runs of this team</Link>
					{row.in_team_list
						? <button type="button" role="menuitem" disabled={!manage.ok} title={manage.reason ?? undefined} onClick={() => { set_open(false); on_remove(); }} className={`${item} ${GATED} text-[var(--g-bad)]`}>Remove from realm…</button>
						: <button type="button" role="menuitem" disabled={!manage.ok} title={manage.reason ?? undefined} onClick={() => { set_open(false); on_add(); }} className={`${item} ${GATED}`}>Add to realm’s team list</button>}
				</div>
			) : null}
		</div>
	);
}

/** Catalog search + install into this realm. */
function Install_drawer({ realm_id, installed, on_close, on_installed }: { realm_id: string; installed: Set<string>; on_close: () => void; on_installed: () => Promise<void> }) {
	const auth_fetch = useAuthFetch();
	const post = use_post();
	const [q, set_q] = useState('');
	const [rows, set_rows] = useState<Array<{ name: string; scope: string | null; description: string; latest_version: string }>>([]);
	const [total, set_total] = useState(0);
	const [loading, set_loading] = useState(false);
	const [busy, set_busy] = useState<string | null>(null);
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const seq = useRef(0);

	async function load(query: string, offset: number) {
		const my = ++seq.current;
		set_loading(true);
		try {
			const res = await auth_fetch('/v1/teams/get', { method: 'POST', body: JSON.stringify({ ...(query ? { query } : {}), status: 'published', limit: 20, offset }) });
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
	useEffect(() => { const t = setTimeout(() => void load(q.trim(), 0), q ? 250 : 0); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

	async function install(scope: string, name: string) {
		const key = `${scope}/${name}`;
		set_busy(key);
		set_msg(null);
		const res = await post('/v1/realms/add_team', { realm_id, scope, slug: name });
		set_busy(null);
		if (!res.ok) { set_msg({ tone: 'bad', text: res.error }); return; }
		set_msg({ tone: 'ok', text: `@${key} added. Online daemons install it now; others on their next heartbeat.` });
		await on_installed();
	}

	return (
		<div className="fixed inset-0 z-50 flex justify-end bg-[var(--g-backdrop)]" role="dialog" aria-label="Install a team" onMouseDown={(e) => { if (e.target === e.currentTarget) on_close(); }}>
			<div className="flex h-full w-[560px] max-w-full flex-col gap-4 overflow-y-auto border-l border-[var(--g-line-strong)] bg-[var(--g-panel)] px-7 py-6 shadow-[var(--g-drawer-shadow)]">
				<div className="flex items-center">
					<h2 className="text-[18px] font-semibold">Install a team</h2>
					<button type="button" onClick={on_close} aria-label="Close" className="ml-auto text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><X className="h-4 w-4" /></button>
				</div>
				<p className="text-[12.5px] text-[var(--g-ink-3)]">Your teams, your orgs’ teams and Marketplace. Adding a team puts it on this realm’s team list and installs it on the realm’s online daemons.</p>
				<div className="flex items-center gap-2 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5">
					<Search aria-hidden className="h-3.5 w-3.5 text-[var(--g-ink-3)]" />
					<input autoFocus aria-label="Search teams to install" value={q} onChange={(e) => set_q(e.target.value)} placeholder="Search by name or @scope/name…" className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-[var(--g-ink)] outline-none" />
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
									: <button type="button" disabled={!t.scope || busy === key} onClick={() => t.scope && void install(t.scope, t.name)} className={ROW_ACTION_CLS}>{busy === key ? 'Adding…' : 'Add to realm'}</button>}
							</li>
						);
					})}
					{!loading && rows.length === 0 ? <li className="px-4 py-6 text-center text-[12.5px] text-[var(--g-ink-3)]">{q ? 'No teams match.' : 'No teams yet.'}</li> : null}
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
	const coverage = ((v) => (v === 'full' || v === 'partial' || v === 'none' ? v : null))(search.get('coverage'));
	const q = search.get('q') ?? '';
	const page = Math.max(0, Number(search.get('page') ?? 0) || 0);
	const [draft, set_draft] = useState(q);
	const [running, set_running] = useState<Realm_team_row | null>(null);
	const [installing, set_installing] = useState(false);
	const [confirm_remove, set_confirm_remove] = useState<string | null>(null);
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

	// Sorted by Core (teams/get realm mode sort_by), so it is right across pages; default = team name.
	const sort = use_table_sort({ keys: ['team', 'origin', 'coverage'], default_sort: { by: 'team', dir: 'asc' } });
	const read = use_bff_read<Realm_teams_data>(
		'/v1/realm_teams/get',
		org && slug ? { org_slug: org, slug, limit: TEAMS_PAGE_SIZE, offset: page * TEAMS_PAGE_SIZE, ...(q ? { q } : {}), ...(coverage ? { coverage } : {}), ...sort.body } : null,
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

	async function act(row: Realm_team_row, kind: 'add' | 'update' | 'remove') {
		if (!realm_id || !row.scope) return;
		set_busy(`${kind}:${row.label}`);
		set_msg(null);
		const res = await post(kind === 'remove' ? '/v1/realms/remove_team' : '/v1/realms/add_team', { realm_id, scope: row.scope, slug: row.slug });
		set_busy(null);
		set_confirm_remove(null);
		if (!res.ok) { set_msg({ tone: 'bad', text: res.error }); return; }
		set_msg({ tone: 'ok', text: kind === 'remove' ? `${row.label} removed; daemons uninstall it.` : kind === 'update' ? `Updating ${row.label} on online daemons.` : `${row.label} added to the realm.` });
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
			<Realm_nav org_slug={org} slug={slug} realm={sidebar_realm} />
			<div className="flex flex-col gap-4 px-7 py-6">
				{read.status === 'error' && !data ? (
					<Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="realm" />
				) : (
					<>
						<div className="flex flex-wrap items-center gap-2">
							<input aria-label="Search teams" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Search teams in this realm…" className={`${INPUT} w-[260px]`} />
							<div role="group" aria-label="Coverage" className="flex flex-wrap gap-2">
								{CHIPS.map((c) => {
									const n = data ? data.counts[c.count] : null;
									return (
										<button key={c.label} type="button" aria-pressed={coverage === c.id} onClick={() => set_param('coverage', c.id)} className={PILL(coverage === c.id)}>
											{c.label}{n !== null && n !== undefined ? <span className="g-mono text-[11px] text-[var(--g-ink-3)]"> {n}</span> : null}
										</button>
									);
								})}
							</div>
							<button type="button" disabled={!realm_id || !manage.ok} title={manage.reason ?? undefined} onClick={() => set_installing(true)} className={`${PRIMARY} ${GATED} ml-auto`}><Plus aria-hidden className="h-3.5 w-3.5" />Install a team</button>
						</div>
						{msg ? <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`text-[12.5px] ${msg.tone === 'bad' ? 'text-[var(--g-bad)]' : 'text-[var(--g-ok)]'}`}>{msg.text}</p> : null}
						<div className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
							{read.status === 'loading' ? <div className="h-[360px] animate-pulse" aria-busy="true" aria-label="Loading teams" /> : null}
							{data && data.items.length === 0 ? (
								<p className="px-4 py-12 text-center text-[13px] text-[var(--g-ink-3)]">{q || coverage ? 'No teams match these filters.' : 'No teams in this realm yet — install one to get started.'}</p>
							) : null}
							{data && data.items.length ? (
								<table className="w-full text-left text-[12.5px]">
									<thead>
										<tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">
											<Sort_th sort={cols} k="team" className="px-4 py-2.5 font-semibold">Team</Sort_th>
											<th className="px-4 py-2.5 font-semibold">Version</th>
											<Sort_th sort={cols} k="coverage" className="px-4 py-2.5 font-semibold" title="Online daemons in this realm that have the team installed">Daemons ready</Sort_th>
											<th className="px-4 py-2.5 font-semibold">Last run</th>
											<th className="w-[230px] px-4 py-2.5" />
										</tr>
									</thead>
									<tbody>
										{data.items.map((r) => {
											const full = r.online_daemon_count > 0 && r.installed_count >= r.online_daemon_count;
											return (
												<tr key={r.label} {...row({ to: r.scope ? `${base}/teams/${encodeURIComponent(r.scope)}/${encodeURIComponent(r.slug)}` : null })} className={`border-b border-[var(--g-line-2)] last:border-b-0 ${r.scope ? ROW_OPENS : ''}`} data-testid={`team-${r.label}`}>
													<td className="max-w-[360px] px-4 py-2.5">
														{r.scope ? <Link to={`${base}/teams/${encodeURIComponent(r.scope)}/${encodeURIComponent(r.slug)}`} className="block truncate text-[13px] font-semibold hover:underline">{r.label}</Link> : <span className="block truncate text-[13px] font-semibold">{r.label}</span>}
														<span className="flex flex-wrap gap-2 text-[11px] text-[var(--g-ink-3)]">
															{r.origin === 'local' ? <span>local install (not published)</span> : null}
															{!r.in_team_list ? <span>on a daemon, not on the realm’s team list</span> : null}
															{r.missing_agents.length ? <span className="inline-flex items-center gap-1 text-[var(--g-warn-text)]"><AlertTriangle aria-hidden className="h-3 w-3" />needs agents: {r.missing_agents.join(', ')}</span> : null}
														</span>
													</td>
													<td className="g-mono whitespace-nowrap px-4 py-2.5 text-[12px]">
														{r.version ?? '—'}
														{r.update_available ? <span className="ml-2 rounded-full bg-[var(--g-acc-soft)] px-2 py-0.5 text-[11px] text-[var(--g-acc)]" data-testid="update-badge">↑ {r.latest_version}</span> : null}
													</td>
													<td className={`g-mono whitespace-nowrap px-4 py-2.5 text-[12px] ${full ? 'text-[var(--g-ink-2)]' : 'text-[var(--g-warn-text)]'}`}>{coverage_text(r)}</td>
													<td className="whitespace-nowrap px-4 py-2.5 text-[var(--g-ink-2)]">{r.last_run_at ? relative_time(r.last_run_at) : 'never'}</td>
													<td className="px-4 py-2.5 text-right">
														{confirm_remove === r.label ? (
															<span className="inline-flex gap-1.5">
																<button type="button" disabled={busy !== null} onClick={() => void act(r, 'remove')} className="rounded-md bg-[var(--g-bad)] px-2.5 py-1 text-[12px] font-semibold text-[var(--g-on-color)]">Remove</button>
																<button type="button" onClick={() => set_confirm_remove(null)} className={ROW_ACTION_CLS}>Keep</button>
															</span>
														) : (
															<span className="inline-flex items-center gap-1.5">
																{r.scope ? <Row_open to={`${base}/teams/${encodeURIComponent(r.scope)}/${encodeURIComponent(r.slug)}`} label={`Open ${r.label}`} /> : null}
																{r.scope && r.in_team_list ? <button type="button" disabled={!runnable.ok} title={runnable.reason ?? undefined} onClick={() => set_running(r)} className={`${ROW_ACTION_CLS} ${GATED} inline-flex items-center gap-1`}><Play aria-hidden className="h-3 w-3" />Run</button> : null}
																{r.update_available ? <button type="button" disabled={busy !== null || !manage.ok} title={manage.reason ?? undefined} onClick={() => void act(r, 'update')} className={`${ROW_ACTION_CLS} ${GATED}`}>{busy === `update:${r.label}` ? 'Updating…' : 'Update'}</button> : null}
																{!r.in_team_list && r.scope ? <button type="button" disabled={busy !== null || !manage.ok} title={manage.reason ?? undefined} onClick={() => void act(r, 'add')} className={`${ROW_ACTION_CLS} ${GATED}`}>Add to realm</button> : null}
																<Row_menu row={r} base={base} on_remove={() => set_confirm_remove(r.label)} on_add={() => void act(r, 'add')} manage={manage} />
															</span>
														)}
													</td>
												</tr>
											);
										})}
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
				<Install_drawer realm_id={realm_id} installed={new Set((data?.items ?? []).filter((r) => r.in_team_list && r.scope).map((r) => `${r.scope}/${r.slug}`))} on_close={() => set_installing(false)} on_installed={() => read.reload()} />
			) : null}
			{running && running.scope && data ? (
				<Run_in_realm_dialog scope={running.scope} slug={running.slug} fixed_realm={{ id: data.realm.id, slug: data.realm.slug, name: data.realm.name }} on_close={() => set_running(null)} />
			) : null}
		</Graphite_shell>
	);
}
