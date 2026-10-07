/**
 * Build › Teams (Graphite). Read: one `POST /v1/team_list/get` per page
 * (BFF: the caller's teams, status counts, phase shape per team, realms each
 * is installed in). Follows the view switcher: an org view shows that org's
 * teams and realms. Write: `/v1/realms/add_team` (install into one realm).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Plus, RefreshCw } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { api_message, use_bff_read } from '@/lib/use_bff_read';
import { use_view_scope } from '@/lib/view_scope';
import { phase_kind, team_href, type Team_list_data, type Team_list_row } from '@/lib/team_page';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Sort_th, use_table_sort } from '@/components/graphite/g_sort';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';
import { avatar_outline } from '@/lib/admin';

export const TEAM_LIST_PAGE_SIZE = 25;

const PILL = (on: boolean) => `inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] ${on ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;
const INPUT = 'h-8 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[12.5px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]';
const PRIMARY = 'inline-flex items-center gap-1.5 rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:opacity-50';

type Status = 'all' | 'published' | 'draft';
const TABS: Array<{ id: Status; label: string }> = [
	{ id: 'all', label: 'All' },
	{ id: 'published', label: 'Published' },
	{ id: 'draft', label: 'Drafts' },
];

export function Team_avatar({ name, size = 36 }: { name: string; size?: number }) {
	const parts = name.split(/[\s-]+/).filter(Boolean);
	const ini = (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
	return (
		<span aria-hidden className="grid shrink-0 place-items-center rounded-lg font-semibold" style={{ width: size, height: size, fontSize: size * 0.33, ...avatar_outline(name, size) }}>{ini}</span>
	);
}

export function Status_badge({ status }: { status: 'draft' | 'published' }) {
	return status === 'draft'
		? <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--g-warn-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--g-warn-text)]"><i aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />Draft</span>
		: <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--g-ok-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--g-ok)]"><i aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />Published</span>;
}

/** One outlined square per phase, in order; hover names the phase and its type. */
function Phase_squares({ types, names }: { types: string[] | null; names?: string[] | null }) {
	if (!types) return <span className="text-[var(--g-ink-3)]">—</span>;
	if (!types.length) return <span className="text-[11.5px] text-[var(--g-ink-3)]">no phases</span>;
	const label = (t: string, i: number) => `${names?.[i] ? `${names[i]} · ` : ''}${phase_kind(t).label}`;
	return (
		<span className="inline-flex items-center gap-[3px]" aria-label={`${types.length} phases: ${types.map(label).join(', ')}`}>
			{types.slice(0, 14).map((t, i) => (
				<i key={i} title={label(t, i)} className="block h-2.5 w-2.5 rounded-[2px] border-[1.5px]" style={{ borderColor: phase_kind(t).color }} />
			))}
			{types.length > 14 ? <span className="text-[11px] text-[var(--g-ink-3)]" title={types.slice(14).map((t, k) => label(t, k + 14)).join(', ')}>+{types.length - 14}</span> : null}
		</span>
	);
}

/** Install one team into one realm (realms come from the overview the shell already loaded). */
export function Install_popover({
	label, scope, name, realms, installed, on_close, on_done,
}: {
	label: string;
	scope: string;
	name: string;
	realms: Array<{ id: string; slug: string; name: string; org_slug: string }>;
	installed: Set<string>;
	on_close: () => void;
	on_done: (msg: string) => void;
}) {
	const auth_fetch = useAuthFetch();
	const [q, set_q] = useState('');
	const [pick, set_pick] = useState<string | null>(null);
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) on_close(); };
		const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') on_close(); };
		document.addEventListener('mousedown', down);
		document.addEventListener('keydown', esc);
		return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', esc); };
	}, [on_close]);
	const shown = realms.filter((r) => !q || `${r.slug} ${r.name} ${r.org_slug}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
	async function install() {
		if (!pick) return;
		set_busy(true); set_err(null);
		try {
			const res = await auth_fetch('/v1/realms/add_team', { method: 'POST', body: JSON.stringify({ realm_id: pick, scope, slug: name }) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) { set_err(api_message(payload, 'Could not install.')); return; }
			const realm = realms.find((r) => r.id === pick);
			on_done(`${label} added to ${realm?.slug ?? 'the realm'}; its online daemons install it.`);
		} catch {
			set_err('Network error — check your connection.');
		} finally {
			set_busy(false);
		}
	}
	return (
		<div ref={ref} role="dialog" aria-label={`Install ${label}`} className="absolute right-0 top-full z-40 mt-1.5 w-[320px] overflow-hidden rounded-[10px] border border-[#33363c] bg-[#16171a] text-left shadow-[0_20px_60px_rgba(0,0,0,.6)]">
			<div className="border-b border-[var(--g-line)] px-3.5 py-2.5 text-[13px] font-semibold">Install {label}</div>
			<div className="border-b border-[var(--g-line)] px-3.5 py-2"><input autoFocus aria-label="Search realms" value={q} onChange={(e) => set_q(e.target.value)} placeholder="Search realms…" className={`${INPUT} w-full`} /></div>
			<div className="max-h-[240px] overflow-auto py-1" role="radiogroup" aria-label="Realm">
				{shown.length === 0 ? <p className="px-3.5 py-3 text-[12px] text-[var(--g-ink-3)]">No realms match.</p> : null}
				{shown.map((r) => {
					const has = installed.has(r.id);
					return (
						<label key={r.id} className={`flex items-center gap-2.5 px-3.5 py-1.5 text-[13px] ${has ? 'text-[var(--g-ink-3)]' : 'cursor-pointer hover:bg-[var(--g-soft)]'}`}>
							<input type="radio" name="install-realm" disabled={has} checked={pick === r.id} onChange={() => set_pick(r.id)} />
							<span className="truncate">{r.slug}</span>
							{has ? <span className="ml-auto text-[11px] text-[var(--g-ink-3)]">installed</span> : null}
						</label>
					);
				})}
			</div>
			{err ? <p role="alert" className="px-3.5 pb-2 text-[12px] text-[var(--g-bad)]">{err}</p> : null}
			<div className="flex gap-2 border-t border-[var(--g-line)] px-3.5 py-2.5">
				<button type="button" disabled={!pick || busy} onClick={() => void install()} className={PRIMARY}>{busy ? 'Installing…' : 'Install'}</button>
				<button type="button" onClick={on_close} className={ROW_ACTION_CLS}>Cancel</button>
			</div>
		</div>
	);
}

export function Component() {
	const overview = use_overview();
	const navigate = useNavigate();
	const scope = use_view_scope(overview.data);
	const [search, set_search] = useSearchParams();
	const status = ((v) => (v === 'published' || v === 'draft' ? v : 'all'))(search.get('status')) as Status;
	const q = search.get('q') ?? '';
	const page = Math.max(0, Number(search.get('page') ?? 0) || 0);
	const [draft, set_draft] = useState(q);
	const [open_install, set_open_install] = useState<string | null>(null);
	const [msg, set_msg] = useState<string | null>(null);
	const view_org = scope.kind === 'all' ? null : scope.org;

	const set_param = (k: string, v: string | null, keep_page = false) => set_search((prev) => {
		const p = new URLSearchParams(prev);
		if (v === null || v === '') p.delete(k); else p.set(k, v);
		if (!keep_page) p.delete('page');
		return p;
	}, { replace: true });
	useEffect(() => { const t = setTimeout(() => { if (draft.trim() !== q) set_param('q', draft.trim() || null); }, 300); return () => clearTimeout(t); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

	// The BFF sorts the whole list before paging it (team_list/get sort_by).
	const sort = use_table_sort({ keys: ['name', 'status'] });
	const body = overview.data || overview.status === 'error'
		? { status, limit: TEAM_LIST_PAGE_SIZE, offset: page * TEAM_LIST_PAGE_SIZE, ...(q ? { q } : {}), ...sort.body, ...(view_org ? { org_id: view_org.id, scope: view_org.slug } : {}) }
		: null;
	const read = use_bff_read<Team_list_data>('/v1/team_list/get', body, { refresh_ms: 60_000, fallback_error: 'Could not load teams.' });
	const data = read.data;
	const cols = sort.with_sortable(data?.sortable);
	const realms = useMemo(() => (overview.data?.orgs ?? []).filter((o) => !view_org || o.id === view_org.id).flatMap((o) => o.realms.map((r) => ({ id: r.id, slug: r.slug, name: r.name, org_slug: r.org_slug }))), [overview.data, view_org]);
	const from = data && data.total ? data.offset + 1 : 0;
	const to = data ? Math.min(data.offset + data.limit, data.total) : 0;
	const org_q = view_org ? `?org=${encodeURIComponent(view_org.slug)}` : '';
	const href = (t: Team_list_row) => `${team_href(t.scope, t.name)}${org_q}`;

	return (
		<Graphite_shell
			data={overview.data}
			title="Teams"
			actions={
				<>
					<button type="button" onClick={() => void read.reload()} aria-label="Refresh" title="Refresh" className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><RefreshCw className="h-3.5 w-3.5" /></button>
					<Link to="/builder" className={PRIMARY}><Plus aria-hidden className="h-3.5 w-3.5" />New team</Link>
				</>
			}
		>
			<div className="flex flex-col gap-4 px-7 py-6">
				<div>
					<h1 className="text-[22px] font-semibold tracking-tight">Teams</h1>
					<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">{view_org ? `Teams ${view_org.display_name} builds and owns.` : 'Teams you and your orgs build and own.'} Build here, then install into any realm.</p>
				</div>
				{read.status === 'error' && !data ? (
					<Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="teams" />
				) : (
					<>
						<div className="flex flex-wrap items-center gap-2">
							<div role="group" aria-label="Status" className="flex gap-2">
								{TABS.map((t) => (
									<button key={t.id} type="button" aria-pressed={status === t.id} onClick={() => set_param('status', t.id === 'all' ? null : t.id)} className={PILL(status === t.id)}>
										{t.label}{data ? <span className="g-mono text-[11px] text-[var(--g-ink-3)]"> {data.counts[t.id]}</span> : null}
									</button>
								))}
							</div>
							<input aria-label="Search teams" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Search teams…" className={`${INPUT} ml-2 w-[260px]`} />
							{data?.partial ? <span className="ml-auto text-[11.5px] text-[var(--g-ink-3)]" title={`Checked ${data.realms_checked} of ${data.realms_total} realms`}>“Installed in” may be incomplete</span> : null}
						</div>
						{msg ? <p role="status" className="text-[12.5px] text-[var(--g-ok)]">{msg}</p> : null}
						<div className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
							{read.status === 'loading' ? <div className="h-[360px] animate-pulse" aria-busy="true" aria-label="Loading teams" /> : null}
							{data && data.items.length === 0 ? (
								<div className="px-4 py-12 text-center text-[13px] text-[var(--g-ink-3)]">
									{q || status !== 'all' ? 'No teams match these filters.' : <>No teams yet. <Link to="/builder" className="text-[var(--g-acc)] hover:underline">Build one</Link> or find one in the <Link to="/browse" className="text-[var(--g-acc)] hover:underline">Marketplace</Link>.</>}
								</div>
							) : null}
							{data && data.items.length ? (
								<table className="w-full text-left text-[12.5px]">
									<thead>
										<tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">
											<Sort_th sort={cols} k="name" className="px-4 py-2.5 font-semibold">Team</Sort_th>
											<th className="px-4 py-2.5 font-semibold">Phases</th>
											<Sort_th sort={cols} k="status" className="px-4 py-2.5 font-semibold">Status</Sort_th>
											<th className="px-4 py-2.5 font-semibold">Latest</th>
											<th className="px-4 py-2.5 font-semibold">Installed in</th>
											<th className="w-[170px] px-4 py-2.5" />
										</tr>
									</thead>
									<tbody>
										{data.items.map((t) => {
											const key = `${t.scope}/${t.name}`;
											return (
												<tr key={key} onClick={() => navigate(href(t))} className="cursor-pointer border-b border-[var(--g-line-2)] last:border-b-0 hover:bg-[var(--g-soft)]" data-testid={`team-${key}`}>
													<td className="max-w-[380px] px-4 py-2.5">
														<div className="flex items-center gap-3">
															<Team_avatar name={t.name} />
															<div className="min-w-0">
																<Link to={href(t)} onClick={(e) => e.stopPropagation()} className="text-[13.5px] font-semibold text-[var(--g-ink)] hover:underline">{t.name}</Link>
																{t.scope ? <span className="g-mono ml-1.5 text-[11px] text-[var(--g-ink-3)]">@{t.scope}</span> : null}
																<span className="block truncate text-[12px] text-[var(--g-ink-3)]">{t.description || '—'}</span>
															</div>
														</div>
													</td>
													<td className="px-4 py-2.5"><Phase_squares types={t.phase_kinds ?? t.phase_types} names={t.phase_names} /></td>
													<td className="px-4 py-2.5"><Status_badge status={t.status} /></td>
													<td className={`px-4 py-2.5 ${t.latest_version ? 'g-mono' : 'text-[var(--g-ink-3)]'}`}>{t.latest_version ?? 'never published'}</td>
													<td className="max-w-[260px] px-4 py-2.5">
														{t.installs.length ? (
															<span className="flex flex-wrap gap-1">
																{t.installs.slice(0, 4).map((i) => (
																	<span key={i.realm_id} title={i.behind ? `${i.realm_slug} runs ${i.version}; ${t.latest_version} is out` : `${i.realm_slug} · ${i.version ?? ''}`} className={`whitespace-nowrap rounded-[5px] px-1.5 py-px text-[11.5px] ${i.behind ? 'bg-[var(--g-warn-soft)] text-[var(--g-warn-text)]' : 'bg-[var(--g-run-soft)] text-[#7cc4ff]'}`}>
																		{i.realm_slug}{i.behind ? ` · on ${i.version}` : ''}
																	</span>
																))}
																{t.installs.length > 4 ? <span className="text-[11.5px] text-[var(--g-ink-3)]">+{t.installs.length - 4}</span> : null}
															</span>
														) : <span className="text-[var(--g-ink-3)]">not installed</span>}
													</td>
													<td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
														<span className="relative inline-flex items-center gap-1.5">
															<Link to={href(t)} className={ROW_ACTION_CLS}>Open</Link>
															{t.status === 'published' && t.scope ? (
																<button type="button" aria-expanded={open_install === key} onClick={() => set_open_install(open_install === key ? null : key)} className={ROW_ACTION_CLS}>Install ▾</button>
															) : null}
															{open_install === key && t.scope ? (
																<Install_popover
																	label={`@${t.scope}/${t.name}`}
																	scope={t.scope}
																	name={t.name}
																	realms={realms}
																	installed={new Set(t.installs.map((i) => i.realm_id))}
																	on_close={() => set_open_install(null)}
																	on_done={(m) => { set_open_install(null); set_msg(m); void read.reload(); }}
																/>
															) : null}
														</span>
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
						<div className="flex flex-wrap items-center gap-4 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-2.5 text-[12px] text-[var(--g-ink-3)]">
							<span>Looking for other people’s teams? <Link to="/browse" className="text-[var(--g-acc)] hover:underline">Marketplace →</Link></span>
						</div>
					</>
				)}
			</div>
		</Graphite_shell>
	);
}
