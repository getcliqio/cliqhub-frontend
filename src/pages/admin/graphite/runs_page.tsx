/**
 * Admin › Activity › Runs — every run on the hub, by state and time.
 * Read: `POST /v1/admin_list/get {kind:'runs'}` (hub-wide on Core API 3; the BFF
 * resolves each run's realm for the link).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { use_bff_read } from '@/lib/use_bff_read';
import { use_overview } from '@/lib/overview';
import { ago, run_href, type Admin_list_data, type Admin_run_row } from '@/lib/admin';
import { Admin_header, Chips, Empty_row, Hub_scope_note, Org_select, Pager, TABLE_WRAP, TH, TR, use_list_params } from '@/components/graphite/g_admin';
import { Sort_th, use_table_sort } from '@/components/graphite/g_sort';
import { State_pill } from '@/components/graphite/g_status';
import { G_INPUT } from '@/components/graphite/g_agents';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

type Filter = 'all' | 'running' | 'awaiting_input' | 'failed' | 'completed';
type Range = '24h' | '7d' | '30d' | 'all';
const LIMIT = 25;

function duration(start: number | null, end: number | null): string {
	if (!start) return '—';
	const s = Math.max(0, Math.round(((end ?? Date.now()) - start) / 1000));
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
	return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function Component() {
	const navigate = useNavigate();
	const overview = use_overview();
	const p = use_list_params();
	const filter = (['running', 'awaiting_input', 'failed', 'completed'].includes(p.get('filter')) ? p.get('filter') : 'all') as Filter;
	const range = (['7d', '30d', 'all'].includes(p.get('range')) ? p.get('range') : '24h') as Range;
	const q = p.get('q');
	const org_id = p.get('org');
	const [draft, set_draft] = useState(q);
	const sort = use_table_sort({ keys: ['run_name', 'state', 'team', 'started_at', 'last_updated_at'], default_sort: { by: 'started_at', dir: 'desc' }, first_dir: { started_at: 'desc', last_updated_at: 'desc' } });
	const read = use_bff_read<Admin_list_data<Admin_run_row>>('/v1/admin_list/get', { kind: 'runs', filter, range, ...sort.body, limit: LIMIT, offset: p.offset, ...(q ? { query: q } : {}), ...(org_id ? { org_id } : {}) }, { refresh_ms: 30_000, fallback_error: 'Could not load runs.' });
	const cols = sort.with_sortable(read.data?.sortable);
	const d = read.data;
	const c = d?.counts ?? {};
	const orgs = d?.org_options ?? overview.data?.orgs ?? [];
	return (
		<div className="flex flex-col gap-4">
			<Admin_header title="Runs" sub="Every run on the hub." />
			{d && !d.hub_wide ? <Hub_scope_note what="runs" /> : null}
			<div className="flex flex-wrap items-center gap-2">
				<Chips<Filter> value={filter} on_change={(k) => p.set({ filter: k === 'all' ? null : k })} options={[
					{ key: 'all', label: 'All', count: c.all },
					{ key: 'running', label: 'Running', count: c.running },
					{ key: 'awaiting_input', label: 'Awaiting input', count: c.awaiting_input, tone: 'warn' },
					{ key: 'failed', label: 'Failed', count: c.failed, tone: 'bad' },
					{ key: 'completed', label: 'Completed', count: c.completed },
				]} />
				<select aria-label="Time range" value={range} onChange={(e) => p.set({ range: e.target.value === '24h' ? null : e.target.value })} className={`${G_INPUT} w-[130px]`}>
					<option value="24h">Last 24h</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">Any time</option>
				</select>
				<Org_select value={org_id} options={orgs} on_change={(v) => p.set({ org: v || null })} placeholder={d?.hub_wide === false ? 'Pick an org…' : 'Org: all'} />
				<form className="ml-auto" onSubmit={(e) => { e.preventDefault(); p.set({ q: draft.trim() || null }); }}>
					<input aria-label="Search runs" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Run name or id" className={`${G_INPUT} w-[220px]`} />
				</form>
			</div>
			{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="runs list" /> : null}
			<div className={TABLE_WRAP}>
				<table className="w-full text-[13px]">
					<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={cols} k="run_name" className={TH}>Run</Sort_th><Sort_th sort={cols} k="team" className={TH}>Team</Sort_th><th className={TH}>Realm</th><Sort_th sort={cols} k="state" className={TH}>State</Sort_th><Sort_th sort={cols} k="started_at" className={TH}>Started</Sort_th><th className={TH}>Duration</th></tr></thead>
					<tbody>
						{read.status === 'loading' ? <Empty_row cols={6}>Loading…</Empty_row> : null}
						{d?.needs_org ? <Empty_row cols={6}>Pick one of your orgs to see its runs.</Empty_row> : null}
						{d && !d.needs_org && !d.items.length ? <Empty_row cols={6}>No runs{filter !== 'all' ? ` ${filter.replace('_', ' ')}` : ''} in this range.</Empty_row> : null}
						{d?.items.map((r) => {
							const href = run_href(r.run_id, r.realm);
							const done = ['completed', 'failed', 'cancelled', 'crashed'].includes(r.state);
							return (
								<tr key={r.run_id} onClick={href ? () => navigate(href) : undefined} className={`${TR} ${href ? 'cursor-pointer hover:bg-[var(--g-soft)]' : ''}`} data-testid={`run-${r.run_id}`}>
									<td className="px-4 py-2.5"><b className="block max-w-[320px] truncate">{r.run_name || r.run_id.slice(0, 12)}</b><span className="g-mono text-[11.5px] text-[var(--g-ink-3)]">{r.run_id.slice(0, 12)}{r.workspace_name ? ` · ${r.workspace_name}` : ''}</span></td>
									<td className="g-mono px-4 text-[12px] text-[var(--g-ink-2)]">{r.team_label ?? '—'}</td>
									<td className="g-mono px-4 text-[12px] text-[var(--g-ink-2)]">{r.realm ? `${r.realm.org_slug ?? '?'}.${r.realm.slug}` : '—'}</td>
									<td className="px-4"><State_pill state={r.state} /></td>
									<td className="px-4 text-[var(--g-ink-3)]">{r.started_at ? `${ago(r.started_at)} ago` : '—'}</td>
									<td className="g-mono px-4 text-[var(--g-ink-3)]">{duration(r.started_at, done ? r.last_updated_at : null)}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
				{d ? <Pager total={d.total} offset={p.offset} limit={LIMIT} on_change={(o) => p.set({ offset: o ? String(o) : null })} /> : null}
			</div>
		</div>
	);
}
