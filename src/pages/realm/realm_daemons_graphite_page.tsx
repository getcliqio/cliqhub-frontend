/**
 * Realm › Daemons (Graphite). Read: one `POST /v1/realm_daemons/get` (BFF:
 * realm gate, Core's daemon list, running runs and team coverage → status
 * counts, "running" and "teams ready" per daemon). Remove is the single
 * Core route `/v1/daemons/remove`.
 */
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { use_overview, relative_time } from '@/lib/overview';
import { api_message, use_bff_read } from '@/lib/use_bff_read';
import { realm_path } from '@/lib/realm_url';
import type { Realm_daemons_data } from '@/lib/realm_daemons';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { use_access } from '@/lib/access';
import { Sort_th, sort_rows, use_table_sort } from '@/components/graphite/g_sort';
import { Realm_nav } from '@/components/graphite/realm_nav';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';
import { ROW_OPENS, Row_open, use_row_open } from '@/components/graphite/g_row';

const PILL = (on: boolean) => `inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] ${on ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;
const INPUT = 'h-8 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[12.5px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]';

const STATUS: Record<string, { label: string; color: string }> = {
	online: { label: 'Online', color: 'var(--g-ok)' },
	stale: { label: 'Stale', color: 'var(--g-warn)' },
	offline: { label: 'Offline', color: 'var(--g-ink-4)' },
};
/** Status order for sorting (online first). */
const STATUS_RANK: Record<string, number> = { online: 0, stale: 1, offline: 2 };

export function Component() {
	const row = use_row_open();
	const { org = '', slug = '' } = useParams();
	const auth_fetch = useAuthFetch();
	const overview = use_overview();
	const access = use_access(overview.data);
	const [search, set_search] = useSearchParams();
	const status = ((v) => (v === 'online' || v === 'stale' || v === 'offline' ? v : null))(search.get('status'));
	const q = search.get('q') ?? '';
	const [draft, set_draft] = useState(q);
	const [confirm, set_confirm] = useState<string | null>(null);
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const base = realm_path(org, slug);

	const set_param = (k: string, v: string | null) => set_search((prev) => { const p = new URLSearchParams(prev); if (v) p.set(k, v); else p.delete(k); return p; }, { replace: true });
	useEffect(() => { const t = setTimeout(() => { if (draft.trim() !== q) set_param('q', draft.trim() || null); }, 250); return () => clearTimeout(t); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

	const read = use_bff_read<Realm_daemons_data>(
		'/v1/realm_daemons/get',
		org && slug ? { org_slug: org, slug, ...(status ? { status } : {}), ...(q ? { q } : {}) } : null,
		{ refresh_ms: 15_000, fallback_error: 'Could not load daemons.' },
	);
	const data = read.data;
	// Every daemon of the realm is loaded (no paging), so sorting here is exact. Default = the BFF's order (status, then heartbeat).
	const sort = use_table_sort({ keys: ['name', 'status', 'hostname', 'last_heartbeat', 'running', 'teams_ready'], mode: 'client', first_dir: { last_heartbeat: 'desc', running: 'desc', teams_ready: 'desc' } });
	const rows = data ? sort_rows(data.items, sort, {
		name: (d) => d.name || d.id, status: (d) => STATUS_RANK[d.status] ?? 9, hostname: (d) => d.hostname,
		last_heartbeat: (d) => d.last_heartbeat, running: (d) => d.running, teams_ready: (d) => d.teams_ready,
	}) : [];
	const realm_id = data?.realm.id ?? null;
	const removable = access.realm(realm_id, 'admin', 'daemons.remove');
	const sidebar_realm = overview.data?.orgs.flatMap((o) => o.realms).find((r) => r.id === realm_id) ?? null;

	async function remove(id: string) {
		set_msg(null);
		try {
			const res = await auth_fetch('/v1/daemons/remove', { method: 'POST', body: JSON.stringify({ daemon_id: id }) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) { set_msg({ tone: 'bad', text: api_message(payload, 'Could not remove the daemon.') }); return; }
			set_msg({ tone: 'ok', text: `${id} removed.` });
			set_confirm(null);
			await read.reload();
		} catch {
			set_msg({ tone: 'bad', text: 'Network error — check your connection.' });
		}
	}

	const chips: Array<{ id: 'online' | 'stale' | 'offline' | null; label: string; n: number | undefined }> = [
		{ id: null, label: 'All', n: data?.counts.all },
		{ id: 'online', label: 'Online', n: data?.counts.online },
		{ id: 'stale', label: 'Stale', n: data?.counts.stale },
		{ id: 'offline', label: 'Offline', n: data?.counts.offline },
	];

	return (
		<Graphite_shell
			data={overview.data}
			current_realm_id={realm_id}
			title="Daemons"
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
							<div role="group" aria-label="Status" className="flex flex-wrap gap-2">
								{chips.map((c) => (
									<button key={c.label} type="button" aria-pressed={status === c.id} onClick={() => set_param('status', c.id)} className={PILL(status === c.id)}>
										{c.id ? <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: STATUS[c.id].color }} /> : null}
										{c.label}{c.n !== undefined ? <span className="g-mono text-[11px] text-[var(--g-ink-3)]"> {c.n}</span> : null}
									</button>
								))}
							</div>
							<input aria-label="Search daemons" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Name, host or id…" className={`${INPUT} ml-auto w-[240px]`} />
						</div>
						{msg ? <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`text-[12.5px] ${msg.tone === 'bad' ? 'text-[var(--g-bad)]' : 'text-[var(--g-ok)]'}`}>{msg.text}</p> : null}
						{data?.partial ? <p role="status" className="text-[12px] text-[var(--g-ink-3)]">Some details (running runs or teams ready) couldn’t be loaded.</p> : null}
						<div className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
							{read.status === 'loading' ? <div className="h-[280px] animate-pulse" aria-busy="true" aria-label="Loading daemons" /> : null}
							{data && data.items.length === 0 ? (
								<p className="px-4 py-12 text-center text-[13px] text-[var(--g-ink-3)]">{q || status ? 'No daemons match.' : 'No daemons in this realm yet.'}</p>
							) : null}
							{data && data.items.length ? (
								<table className="w-full text-left text-[12.5px]">
									<thead>
										<tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">
											<Sort_th sort={sort} k="name" className="px-4 py-2.5 font-semibold">Daemon</Sort_th>
											<Sort_th sort={sort} k="status" className="px-4 py-2.5 font-semibold">Status</Sort_th>
											<Sort_th sort={sort} k="hostname" className="px-4 py-2.5 font-semibold">Host</Sort_th>
											<Sort_th sort={sort} k="last_heartbeat" className="px-4 py-2.5 font-semibold">Last heartbeat</Sort_th>
											<Sort_th sort={sort} k="running" className="px-4 py-2.5 font-semibold">Running</Sort_th>
											<Sort_th sort={sort} k="teams_ready" className="px-4 py-2.5 font-semibold" title="Teams on this realm’s team list that this daemon has installed">Teams ready</Sort_th>
											<th className="w-[160px] px-4 py-2.5" />
										</tr>
									</thead>
									<tbody>
										{rows.map((d) => {
											const st = STATUS[d.status] ?? { label: d.status, color: 'var(--g-ink-3)' };
											const short = data.teams_total !== null && d.teams_ready !== null && d.teams_ready < data.teams_total;
											return (
												<tr key={d.id} {...row({ to: `${base}/daemons/${encodeURIComponent(d.id)}` })} className={`border-b border-[var(--g-line-2)] last:border-b-0 ${ROW_OPENS}`} data-testid={`daemon-${d.id}`}>
													<td className="max-w-[260px] px-4 py-2.5">
														<Link to={`${base}/daemons/${encodeURIComponent(d.id)}`} className="block truncate text-[13px] font-semibold hover:underline">{d.name || d.id}</Link>
														<span className="g-mono block truncate text-[11px] text-[var(--g-ink-3)]">{d.name ? d.id : d.owner_email ?? ''}</span>
													</td>
													<td className="px-4 py-2.5"><span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--g-soft)] px-2 py-0.5 text-[11.5px] font-semibold" style={{ color: st.color === '#4a4d55' ? 'var(--g-ink-3)' : st.color }}><span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />{st.label}</span></td>
													<td className="max-w-[200px] truncate px-4 py-2.5 text-[var(--g-ink-2)]">{d.hostname ?? '—'}</td>
													<td className="whitespace-nowrap px-4 py-2.5 text-[var(--g-ink-2)]" title={d.last_heartbeat ? new Date(d.last_heartbeat).toLocaleString() : undefined}>{d.last_heartbeat ? relative_time(d.last_heartbeat) : 'never'}</td>
													<td className="g-mono px-4 py-2.5">{d.running}{d.capacity ? <span className="text-[var(--g-ink-3)]"> / {d.capacity}</span> : null}</td>
													<td className={`g-mono px-4 py-2.5 ${short ? 'text-[var(--g-warn-text)]' : ''}`}>{d.teams_ready === null ? '—' : `${d.teams_ready}/${data.teams_total ?? '?'}`}</td>
													<td className="px-4 py-2.5 text-right">
														{confirm === d.id ? (
															<span className="inline-flex gap-1.5">
																<button type="button" onClick={() => void remove(d.id)} className="rounded-md bg-[var(--g-bad)] px-2.5 py-1 text-[12px] font-semibold text-[var(--g-on-color)]">Remove</button>
																<button type="button" onClick={() => set_confirm(null)} className={ROW_ACTION_CLS}>Keep</button>
															</span>
														) : (
															<span className="inline-flex items-center gap-2"><Row_open to={`${base}/daemons/${encodeURIComponent(d.id)}`} label={`Open ${d.name || d.id}`} /><button type="button" aria-label={`Remove ${d.name || d.id}`} disabled={!removable.ok} title={removable.reason ?? undefined} onClick={() => set_confirm(d.id)} className="text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-bad)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:text-[var(--g-ink-3)]">Remove…</button></span>
														)}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							) : null}
						</div>
						{data?.truncated ? <p className="text-[12px] text-[var(--g-ink-3)]">Showing the first {data.items.length} daemons.</p> : null}
						<div className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-3.5 text-[12.5px] text-[var(--g-ink-2)]">
							<b className="text-[13px] font-semibold text-[var(--g-ink)]">Add a machine</b>
							<p className="mt-1">Install the CLI and run <code className="g-mono rounded bg-[var(--g-soft)] px-1.5 py-0.5">cliq login</code> then <code className="g-mono rounded bg-[var(--g-soft)] px-1.5 py-0.5">cliqd</code>. To enroll a server into this realm without logging in, create a daemon token in <Link to={`${base}/settings?section=tokens`} className="text-[var(--g-acc)] hover:underline">Settings › Access tokens</Link>. Runs go to an online daemon that has the team ready.</p>
						</div>
					</>
				)}
			</div>
		</Graphite_shell>
	);
}
