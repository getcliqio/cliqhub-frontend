/**
 * Build › Teams (Graphite): tabs All (own teams and teams installed in the realms), Published and Drafts
 * (own teams only). Read: one `POST /v1/team_list/get` per page (BFF: counts per tab, phase shape per team). Follows the view
 * switcher: an org view shows that org's teams and realms. Write: `/v1/realms/add_team` (install
 * a published team into one realm). A row opens the team.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
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
import { ROW_OPENS, use_row_open } from '@/components/graphite/g_row';

export const TEAM_LIST_PAGE_SIZE = 25;

const TAB = (on: boolean) => `-mb-px inline-flex items-center gap-1.5 border-b-2 px-1 pb-2 text-[13px] ${on ? 'border-[var(--g-acc)] font-semibold text-[var(--g-ink)]' : 'border-transparent text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;
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

/** A realm the BFF says will not, or did not, get the team. */
interface Install_failure { realm_id: string; realm_slug: string | null; error: string }

/**
 * Install one team into one or more realms (realms come from the overview the shell already
 * loaded). One request: the BFF checks every realm first and installs nothing when any fails;
 * then it installs realm by realm. On an error the dialog stays open with the message and each
 * failing realm marked, so the selection can be fixed and tried again.
 */
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
	const [picked, set_picked] = useState<Set<string>>(new Set());
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	const [failed, set_failed] = useState<Map<string, string>>(new Map());
	// Realms installed by an earlier, partly successful attempt in this dialog.
	const [added, set_added] = useState<Set<string>>(new Set());
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const down = (e: MouseEvent) => { if (!busy && ref.current && !ref.current.contains(e.target as Node)) on_close(); };
		const esc = (e: KeyboardEvent) => { if (!busy && e.key === 'Escape') on_close(); };
		document.addEventListener('mousedown', down);
		document.addEventListener('keydown', esc);
		return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', esc); };
	}, [on_close, busy]);
	const has = (id: string) => installed.has(id) || added.has(id);
	const shown = realms.filter((r) => !q || `${r.slug} ${r.name} ${r.org_slug}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
	const slug_of = (id: string) => realms.find((r) => r.id === id)?.slug ?? id;
	function toggle(id: string) {
		set_picked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
		set_failed((prev) => { if (!prev.has(id)) return prev; const next = new Map(prev); next.delete(id); return next; });
	}
	async function install() {
		const realm_ids = [...picked].filter((id) => !has(id));
		if (!realm_ids.length) return;
		set_busy(true); set_err(null); set_failed(new Map());
		try {
			const res = await auth_fetch('/v1/realms/add_team', { method: 'POST', body: JSON.stringify({ scope, slug: name, realm_ids }) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) {
				const details = payload?.error?.details as { failed?: Install_failure[]; installed?: Array<{ realm_id: string }> } | undefined;
				set_failed(new Map((details?.failed ?? []).map((f) => [f.realm_id, f.error])));
				if (details?.installed?.length) {
					const done = details.installed.map((i) => i.realm_id);
					set_added((prev) => new Set([...prev, ...done]));
					set_picked((prev) => new Set([...prev].filter((id) => !done.includes(id))));
				}
				set_err(api_message(payload, 'Could not install.'));
				return;
			}
			const names = realm_ids.map(slug_of);
			on_done(`${label} added to ${names.join(', ')}; their online daemons install it.`);
		} catch {
			set_err('Network error — check your connection, then try again.');
		} finally {
			set_busy(false);
		}
	}
	const count = [...picked].filter((id) => !has(id)).length;
	return (
		<div ref={ref} role="dialog" aria-label={`Install ${label}`} aria-busy={busy} className="absolute right-0 top-full z-40 mt-1.5 w-[340px] overflow-hidden rounded-[10px] border border-[var(--g-line-strong)] bg-[var(--g-pop)] text-left shadow-[var(--g-pop-shadow)]">
			<div className="border-b border-[var(--g-line)] px-3.5 py-2.5 text-[13px] font-semibold">Install {label}</div>
			<div className="border-b border-[var(--g-line)] px-3.5 py-2"><input autoFocus aria-label="Search realms" value={q} disabled={busy} onChange={(e) => set_q(e.target.value)} placeholder="Search realms…" className={`${INPUT} w-full`} /></div>
			<div className="max-h-[260px] overflow-auto py-1" role="group" aria-label="Realms">
				{shown.length === 0 ? <p className="px-3.5 py-3 text-[12px] text-[var(--g-ink-3)]">No realms match.</p> : null}
				{shown.map((r) => {
					const done = has(r.id);
					const why = failed.get(r.id);
					return (
						<label key={r.id} data-testid={`install-realm-${r.slug}`} className={`flex items-start gap-2.5 px-3.5 py-1.5 text-[13px] ${done ? 'text-[var(--g-ink-3)]' : 'cursor-pointer hover:bg-[var(--g-soft)]'} ${why ? 'bg-[var(--g-bad-soft)]' : ''}`}>
							<input type="checkbox" className="mt-[3px]" disabled={done || busy} checked={done || picked.has(r.id)} onChange={() => toggle(r.id)} />
							<span className="min-w-0 flex-1">
								<span className="block truncate">{r.slug}</span>
								{why ? <span className="block text-[11.5px] text-[var(--g-bad)]">{why}</span> : null}
							</span>
							{done ? <span className="ml-auto text-[11px] text-[var(--g-ink-3)]">installed</span> : null}
						</label>
					);
				})}
			</div>
			{err ? <p role="alert" className="border-t border-[var(--g-line)] px-3.5 py-2 text-[12px] text-[var(--g-bad)]">{err}{failed.size ? ' Untick the marked realms or fix access, then try again.' : ''}</p> : null}
			<div className="flex gap-2 border-t border-[var(--g-line)] px-3.5 py-2.5">
				<button type="button" disabled={!count || busy} onClick={() => void install()} className={PRIMARY}>
					{busy ? 'Installing…' : count > 1 ? `Install in ${count} realms` : 'Install'}
				</button>
				{/* After a partly successful attempt, closing reports what was added (and refreshes the page). */}
				<button type="button" disabled={busy} onClick={added.size ? () => on_done(`${label} added to ${[...added].map(slug_of).join(', ')}.`) : on_close} className={ROW_ACTION_CLS}>{added.size ? 'Close' : 'Cancel'}</button>
			</div>
		</div>
	);
}

export function Component() {
	const row = use_row_open();
	const overview = use_overview();
	const scope = use_view_scope(overview.data);
	const [search, set_search] = useSearchParams();
	const status: Status = search.get('status') === 'draft' ? 'draft' : search.get('status') === 'published' ? 'published' : 'all';
	const page = Math.max(0, Number(search.get('page') ?? 0) || 0);
	const [open_install, set_open_install] = useState<string | null>(null);
	const [msg, set_msg] = useState<string | null>(null);
	const view_org = scope.kind === 'all' ? null : scope.org;

	const set_param = (k: string, v: string | null, keep_page = false) => set_search((prev) => {
		const p = new URLSearchParams(prev);
		if (v === null || v === '') p.delete(k); else p.set(k, v);
		if (!keep_page) p.delete('page');
		return p;
	}, { replace: true });

	// The BFF sorts the whole list before paging it (team_list/get sort_by).
	const sort = use_table_sort({ keys: ['name'] });
	const body = overview.data || overview.status === 'error'
		? { status, limit: TEAM_LIST_PAGE_SIZE, offset: page * TEAM_LIST_PAGE_SIZE, ...sort.body, ...(view_org ? { org_id: view_org.id, scope: view_org.slug } : {}) }
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
		<Graphite_shell data={overview.data} title="Teams">
			<div className="flex flex-col gap-4 px-7 py-6">
				<div className="flex flex-wrap items-start gap-3">
					<div className="min-w-0 flex-1">
						<h1 className="text-[22px] font-semibold tracking-tight">Teams</h1>
						<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">{view_org ? `Teams ${view_org.display_name} builds, and teams installed in its realms.` : 'Teams you and your orgs build, and teams installed in your realms.'} Build here, then install into any realm.</p>
					</div>
					<Link to="/builder" className={PRIMARY}><Plus aria-hidden className="h-3.5 w-3.5" />New team</Link>
				</div>
				{read.status === 'error' && !data ? (
					<Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="teams" />
				) : (
					<>
						<div role="tablist" aria-label="Teams" className="flex gap-5 border-b border-[var(--g-line)]">
							{TABS.map((t) => (
								<button key={t.id} type="button" role="tab" aria-selected={status === t.id} onClick={() => set_param('status', t.id === 'all' ? null : t.id)} className={TAB(status === t.id)}>
									{t.label}{data ? <span className="g-mono text-[11px] font-normal text-[var(--g-ink-3)]">{data.counts[t.id]}</span> : null}
								</button>
							))}
						</div>
						{msg ? <p role="status" className="text-[12.5px] text-[var(--g-ok)]">{msg}</p> : null}
						<div className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
							{read.status === 'loading' ? <div className="h-[360px] animate-pulse" aria-busy="true" aria-label="Loading teams" /> : null}
							{data && data.items.length === 0 ? (
								<div className="px-4 py-12 text-center text-[13px] text-[var(--g-ink-3)]">
									{status === 'draft' ? 'No drafts.' : <>No {status === 'published' ? 'published ' : ''}teams yet. <Link to="/builder" className="text-[var(--g-acc)] hover:underline">Build one</Link>.</>}
								</div>
							) : null}
							{data && data.items.length ? (
								<table className="w-full text-left text-[12.5px]">
									<thead>
										<tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">
											<Sort_th sort={cols} k="name" className="px-4 py-2.5 font-semibold">Team</Sort_th>
											<th className="px-4 py-2.5 font-semibold">Phases</th>
											<th className="px-4 py-2.5 font-semibold">Latest</th>
											<th className="w-[120px] px-4 py-2.5" />
										</tr>
									</thead>
									<tbody>
										{data.items.map((t) => {
											const key = `${t.scope}/${t.name}`;
											return (
												<tr key={key} {...row({ to: href(t) })} className={`border-b border-[var(--g-line-2)] last:border-b-0 ${ROW_OPENS}`} data-testid={`team-${key}`}>
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
													<td className={`px-4 py-2.5 ${t.latest_version ? 'g-mono' : 'text-[var(--g-ink-3)]'}`}>{t.latest_version ?? 'never published'}</td>
													<td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
														<span className="relative inline-flex items-center gap-1.5">
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
					</>
				)}
			</div>
		</Graphite_shell>
	);
}
