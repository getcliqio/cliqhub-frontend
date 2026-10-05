/**
 * Admin › Fleet › Daemons (AD4) — every daemon, by status.
 * Read: `POST /v1/admin_list/get {kind:'daemons', org_id?, realm_id?}` (rows + per-status counts).
 * Hub-wide on Core API 3; before that, pick one of your orgs.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { use_bff_read } from '@/lib/use_bff_read';
import { ago, type Admin_daemon_row, type Admin_list_data } from '@/lib/admin';
import { Admin_header, Chips, Empty_row, Few, Hub_scope_note, Pager, Pill, Stat_tile, TABLE_WRAP, TH, TR } from '@/components/graphite/g_admin';
import { Org_filter, Realm_filter } from '@/components/graphite/g_lookup';
import { Sort_th, use_table_sort } from '@/components/graphite/g_sort';
import { G_INPUT } from '@/components/graphite/g_agents';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

type Filter = 'all' | 'online' | 'stale' | 'offline';
const LIMIT = 25;
const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'muted'> = { online: 'ok', stale: 'warn', offline: 'bad' };

export function Component() {
	const navigate = useNavigate();
	const [sp, set_sp] = useSearchParams();
	const filter = (['all', 'online', 'stale', 'offline'].includes(sp.get('filter') ?? '') ? sp.get('filter') : 'all') as Filter;
	const q = sp.get('q') ?? '';
	const org_id = sp.get('org') ?? '';
	const realm_id = sp.get('realm') ?? '';
	const offset = Number(sp.get('offset') ?? 0) || 0;
	const [draft, set_draft] = useState(q);
	const sort = use_table_sort({ keys: ['name', 'status', 'last_heartbeat'], first_dir: { last_heartbeat: 'desc' } });
	const read = use_bff_read<Admin_list_data<Admin_daemon_row>>('/v1/admin_list/get', { kind: 'daemons', filter, ...sort.body, limit: LIMIT, offset, ...(q ? { query: q } : {}), ...(org_id ? { org_id } : {}), ...(realm_id ? { realm_id } : {}) }, { refresh_ms: 30_000, fallback_error: 'Could not load daemons.' });
	const cols = sort.with_sortable(read.data?.sortable);
	const d = read.data;
	const set = (patch: Record<string, string | null>) => {
		const n = new URLSearchParams(sp);
		for (const [k, v] of Object.entries(patch)) { if (!v) n.delete(k); else n.set(k, v); }
		set_sp(n, { replace: true });
	};
	const c = d?.counts ?? {};

	return (
		<div className="flex flex-col gap-4">
			<Admin_header title="Daemons" sub="Every registered daemon, and whether it’s reachable." />
			{d && !d.hub_wide ? <Hub_scope_note what="daemons" /> : null}
			<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
				<Stat_tile label="Online" value={c.online ?? '—'} sub={c.all != null ? `of ${c.all} daemons` : undefined} tone="ok" />
				<Stat_tile label="Stale" value={c.stale ?? '—'} sub="missed recent heartbeats" tone={c.stale ? 'warn' : undefined} />
				<Stat_tile label="Offline" value={c.offline ?? '—'} tone={c.offline ? 'bad' : undefined} />
				<Stat_tile label="Total" value={c.all ?? '—'} />
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Chips<Filter> value={filter} on_change={(k) => set({ filter: k === 'all' ? null : k, offset: null })} options={[
					{ key: 'all', label: 'All', count: c.all },
					{ key: 'online', label: 'Online', count: c.online },
					{ key: 'stale', label: 'Stale', count: c.stale, tone: 'warn' },
					{ key: 'offline', label: 'Offline', count: c.offline, tone: 'bad' },
				]} />
				<Org_filter value={org_id} on_change={(v) => set({ org: v || null, realm: null, offset: null })} all_label={d?.hub_wide === false ? 'Pick an org…' : 'Org: all'} />
				<Realm_filter key={org_id} value={realm_id} org_id={org_id || undefined} on_change={(v) => set({ realm: v || null, offset: null })} />
				<form className="ml-auto" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || null, offset: null }); }}>
					<input aria-label="Search daemons" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Name, host or id" className={`${G_INPUT} w-[240px]`} />
				</form>
			</div>
			{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="daemons list" /> : null}
			<div className={TABLE_WRAP}>
				<table className="w-full text-[13px]">
					<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={cols} k="name" className={TH}>Daemon</Sort_th><th className={TH}>Org</th><th className={TH}>Realms</th><Sort_th sort={cols} k="status" className={TH}>Status</Sort_th><Sort_th sort={cols} k="last_heartbeat" className={TH}>Heartbeat</Sort_th><th className={TH}>Capacity</th></tr></thead>
					<tbody>
						{read.status === 'loading' ? <Empty_row cols={6}>Loading…</Empty_row> : null}
						{d?.needs_org ? <Empty_row cols={6}>Pick one of your orgs to see its daemons.</Empty_row> : null}
						{d && !d.needs_org && !d.items.length ? <Empty_row cols={6}>No daemons{filter !== 'all' ? ` are ${filter}` : ''}.</Empty_row> : null}
						{d?.items.map((x) => {
							const r = x.realms[0];
							const href = r?.org_slug ? `/o/${r.org_slug}/realms/${r.slug}/daemons/${x.id}` : null;
							return (
								<tr key={x.id} onClick={href ? () => navigate(href) : undefined} className={`${TR} ${href ? 'cursor-pointer hover:bg-[var(--g-soft)]' : ''}`} data-testid={`daemon-${x.id}`}>
									<td className="px-4 py-2.5"><b className="g-mono">{x.name || x.hostname || x.id.slice(0, 8)}</b>{x.hostname && x.name ? <div className="text-[12px] text-[var(--g-ink-3)]">{x.hostname}</div> : null}</td>
									<td className="px-4 text-[var(--g-ink-2)]"><Few items={[...new Set(x.realms.map((rr) => rr.org_slug).filter((s): s is string => Boolean(s)))]} /></td>
									<td className="px-4 text-[var(--g-ink-2)]"><Few items={x.realms.map((rr) => rr.slug)} max={3} /></td>
									<td className="px-4"><Pill tone={TONE[x.status] ?? 'muted'}>● {x.status[0].toUpperCase() + x.status.slice(1)}</Pill></td>
									<td className="px-4 text-[var(--g-ink-3)]">{x.last_heartbeat ? `${ago(x.last_heartbeat)} ago` : '—'}</td>
									<td className="g-mono px-4 text-[var(--g-ink-3)]">{x.capacity ?? '—'}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
				{d ? <Pager total={d.total} offset={offset} limit={LIMIT} on_change={(o) => set({ offset: o ? String(o) : null })} /> : null}
			</div>
		</div>
	);
}
