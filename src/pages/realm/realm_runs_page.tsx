/**
 * Realm › Runs (Graphite). One `POST /v1/realm_runs/get` per page: the BFF
 * resolves the realm, asks Core for one filtered page and the chip counts.
 * Filters live in the URL (?state=&range=&q=&page=; ?team= from team pages)
 * so links and refresh keep them.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { use_overview, relative_time } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { run_href } from '@/lib/realm_inbox';
import { duration, RANGE_MS, type Realm_runs_data, type Run_range, type Run_state_filter } from '@/lib/realm_runs';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Realm_nav } from '@/components/graphite/realm_nav';
import { State_pill } from '@/components/graphite/g_status';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

export const RUNS_PAGE_SIZE = 25;
export const RUNS_REFRESH_MS = 20_000;

const STATES: Array<{ id: Run_state_filter | null; label: string; count?: keyof Realm_runs_data['counts'] }> = [
	{ id: null, label: 'All', count: 'all' },
	{ id: 'running', label: 'Running', count: 'running' },
	{ id: 'awaiting_input', label: 'Needs input', count: 'awaiting_input' },
	{ id: 'failed', label: 'Failed · 7d', count: 'failed_7d' },
	{ id: 'completed', label: 'Completed' },
	{ id: 'cancelled', label: 'Cancelled' },
];

const PILL = (on: boolean) => `inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] ${on ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;
const INPUT = 'h-8 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[12.5px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]';

function parse_state(v: string | null): Run_state_filter | null {
	return v === 'running' || v === 'awaiting_input' || v === 'failed' || v === 'completed' || v === 'cancelled' ? v : null;
}
function parse_range(v: string | null): Run_range | null {
	return v === '24h' || v === '7d' || v === '30d' ? v : null;
}

export function Component() {
	const { org = '', slug = '' } = useParams();
	const navigate = useNavigate();
	const overview = use_overview();
	const [search, set_search] = useSearchParams();
	const state = parse_state(search.get('state'));
	// "Failed" means the last 7 days unless a range is picked (matches the chip count).
	const range = parse_range(search.get('range')) ?? (state === 'failed' ? '7d' : null);
	// `?team=` comes from team pages; Core's run search also matches the team label.
	const q = search.get('q') ?? search.get('team') ?? '';
	const page = Math.max(0, Number(search.get('page') ?? 0) || 0);
	const [draft, set_draft] = useState(q);
	// Round "since" to the minute so polling doesn't change the request every tick.
	const [since_base] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);

	const set_param = (k: string, v: string | null, keep_page = false) => set_search((prev) => {
		const p = new URLSearchParams(prev);
		if (v === null || v === '') p.delete(k); else p.set(k, v);
		if (k === 'q') p.delete('team');
		if (!keep_page) p.delete('page');
		return p;
	}, { replace: true });

	useEffect(() => { const t = setTimeout(() => { if (draft.trim() !== q) set_param('q', draft.trim() || null); }, 300); return () => clearTimeout(t); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

	const body: Record<string, unknown> | null = org && slug ? {
		org_slug: org, slug, limit: RUNS_PAGE_SIZE, offset: page * RUNS_PAGE_SIZE,
		...(state ? { state } : {}), ...(q ? { q } : {}), ...(range ? { since_ms: since_base - RANGE_MS[range] } : {}),
	} : null;
	const read = use_bff_read<Realm_runs_data>('/v1/realm_runs/get', body, { refresh_ms: RUNS_REFRESH_MS, fallback_error: 'Could not load runs.' });
	const data = read.data;
	const realm_id = data?.realm.id ?? null;
	const sidebar_realm = overview.data?.orgs.flatMap((o) => o.realms).find((r) => r.id === realm_id) ?? null;
	const from = data && data.total ? data.offset + 1 : 0;
	const to = data ? Math.min(data.offset + data.limit, data.total) : 0;

	return (
		<Graphite_shell
			data={overview.data}
			current_realm_id={realm_id}
			title="Runs"
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
							<div role="group" aria-label="State" className="flex flex-wrap gap-2">
								{STATES.map((s) => {
									const n = s.count && data ? data.counts[s.count] : null;
									return (
										<button key={s.label} type="button" aria-pressed={state === s.id} onClick={() => set_search((prev) => { const p = new URLSearchParams(prev); if (s.id) p.set('state', s.id); else p.delete('state'); p.delete('range'); p.delete('page'); return p; }, { replace: true })} className={PILL(state === s.id)}>
											{s.label}{n !== null && n !== undefined ? <span className="g-mono text-[11px] text-[var(--g-ink-3)]">{n.toLocaleString()}</span> : null}
										</button>
									);
								})}
							</div>
							<select aria-label="Time range" value={range ?? ''} onChange={(e) => set_param('range', e.target.value || null)} className={`${INPUT} ml-2 w-[150px]`}>
								<option value="">Any time</option>
								<option value="24h">Last 24 hours</option>
								<option value="7d">Last 7 days</option>
								<option value="30d">Last 30 days</option>
							</select>
							<input aria-label="Search runs" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Search run, ticket, team, id…" className={`${INPUT} ml-auto w-[260px]`} />
						</div>
						{read.status === 'error' && data ? <p role="status" className="text-[12px] text-[var(--g-warn-text)]">Showing the last loaded page — {read.error}</p> : null}
						{data?.partial ? <p role="status" className="text-[12px] text-[var(--g-ink-3)]">Some counts couldn’t be loaded.</p> : null}
						<div className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
							{read.status === 'loading' ? <div className="h-[420px] animate-pulse" aria-busy="true" aria-label="Loading runs" /> : null}
							{data && data.items.length === 0 ? (
								<p className="px-4 py-12 text-center text-[13px] text-[var(--g-ink-3)]">{q || state || range ? 'No runs match these filters.' : 'No runs in this realm yet.'}</p>
							) : null}
							{data && data.items.length ? (
								<table className="w-full text-left text-[12.5px]">
									<thead>
										<tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">
											<th className="px-4 py-2.5 font-semibold">Run</th>
											<th className="px-4 py-2.5 font-semibold">Team</th>
											<th className="px-4 py-2.5 font-semibold">State</th>
											<th className="px-4 py-2.5 font-semibold">Phase</th>
											<th className="px-4 py-2.5 font-semibold">Started</th>
											<th className="px-4 py-2.5 font-semibold">Took</th>
											<th className="px-4 py-2.5 font-semibold">Daemon</th>
										</tr>
									</thead>
									<tbody>
										{data.items.map((r) => {
											const href = run_href(org, slug, r.run_id);
											return (
												<tr key={r.run_id} onClick={() => navigate(href)} className="cursor-pointer border-b border-[var(--g-line-2)] last:border-b-0 hover:bg-[var(--g-soft)]" data-testid={`run-${r.run_id}`}>
													<td className="max-w-[340px] px-4 py-2.5">
														<Link to={href} onClick={(e) => e.stopPropagation()} className="block truncate text-[13px] font-semibold text-[var(--g-ink)] hover:underline">{r.run_name || r.run_id}</Link>
														{r.error && (r.state === 'failed' || r.state === 'crashed') ? <span className="g-mono block truncate text-[11px] text-[var(--g-bad)]">{r.error}</span> : <span className="g-mono block truncate text-[11px] text-[var(--g-ink-3)]">{r.run_id}</span>}
													</td>
													<td className="g-mono max-w-[200px] truncate px-4 py-2.5 text-[12px] text-[var(--g-ink-2)]">{r.team ?? '—'}</td>
													<td className="px-4 py-2.5"><State_pill state={r.state} /></td>
													<td className="max-w-[160px] truncate px-4 py-2.5 text-[var(--g-ink-2)]">{r.current_phase ?? '—'}</td>
													<td className="whitespace-nowrap px-4 py-2.5 text-[var(--g-ink-2)]" title={r.started_at ? new Date(r.started_at).toLocaleString() : undefined}>{relative_time(r.started_at)}</td>
													<td className="g-mono whitespace-nowrap px-4 py-2.5 text-[12px]">{duration(r.started_at, r.state === 'running' || r.state === 'awaiting_input' ? null : r.completed_at ?? r.updated_at)}</td>
													<td className="g-mono max-w-[160px] truncate px-4 py-2.5 text-[12px] text-[var(--g-ink-3)]">{r.daemon_id ?? '—'}</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							) : null}
							{data && data.total ? (
								<div className="flex items-center justify-end gap-2 border-t border-[var(--g-line)] px-4 py-2.5 text-[12px] text-[var(--g-ink-3)]">
									<span data-testid="runs-range">{from.toLocaleString()}–{to.toLocaleString()} of {data.total.toLocaleString()}</span>
									<button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => set_param('page', page - 1 ? String(page - 1) : null, true)} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] text-[var(--g-ink-2)] hover:bg-[var(--g-soft)] disabled:opacity-40">‹</button>
									<button type="button" aria-label="Next page" disabled={to >= data.total} onClick={() => set_param('page', String(page + 1), true)} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] text-[var(--g-ink-2)] hover:bg-[var(--g-soft)] disabled:opacity-40">›</button>
								</div>
							) : null}
						</div>
					</>
				)}
			</div>
		</Graphite_shell>
	);
}
