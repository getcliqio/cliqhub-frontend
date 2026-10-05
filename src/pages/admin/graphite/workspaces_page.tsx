/**
 * Admin › Fleet › Workspaces — every registered workspace: which orgs, realms and
 * daemons it runs on, and what's running in it.
 * Read: `POST /v1/admin_list/get {kind:'workspaces', org_id?, realm_id?}`.
 */
import { use_bff_read } from '@/lib/use_bff_read';
import { ago, type Admin_list_data, type Admin_workspace_row } from '@/lib/admin';
import { Admin_header, Empty_row, Few, Pager, Pill, TABLE_WRAP, TH, TR, use_list_params } from '@/components/graphite/g_admin';
import { Org_filter, Realm_filter } from '@/components/graphite/g_lookup';
import { Sort_th, use_table_sort } from '@/components/graphite/g_sort';
import { State_pill } from '@/components/graphite/g_status';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

const LIMIT = 25;

function daemons_of(w: Admin_workspace_row): string[] {
	const list = w.daemons?.length ? w.daemons : w.daemon_id ? [{ id: w.daemon_id, name: w.daemon_name }] : [];
	return list.map((d) => d.name ?? d.id.slice(0, 10));
}

export function Component() {
	const p = use_list_params();
	const org_id = p.get('org');
	const realm_id = p.get('realm');
	const sort = use_table_sort({ keys: ['name', 'created_at'] });
	const read = use_bff_read<Admin_list_data<Admin_workspace_row>>('/v1/admin_list/get', { kind: 'workspaces', ...sort.body, limit: LIMIT, offset: p.offset, ...(org_id ? { org_id } : {}), ...(realm_id ? { realm_id } : {}) }, { refresh_ms: 30_000, fallback_error: 'Could not load workspaces.' });
	const cols = sort.with_sortable(read.data?.sortable);
	const d = read.data;
	const narrowed = Boolean(org_id || realm_id);
	return (
		<div className="flex flex-col gap-4">
			<Admin_header title="Workspaces" sub={d ? `${d.total.toLocaleString('en-US')} workspace${d.total === 1 ? '' : 's'}${narrowed ? ' here' : ' registered by daemons'}.` : 'Every workspace registered by a daemon.'} />
			<div className="flex flex-wrap items-center gap-2">
				<Org_filter value={org_id} on_change={(v) => p.set({ org: v || null, realm: null })} />
				<Realm_filter key={org_id} value={realm_id} org_id={org_id || undefined} on_change={(v) => p.set({ realm: v || null })} />
			</div>
			{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="workspaces list" /> : null}
			<div className={TABLE_WRAP}>
				<table className="w-full text-[13px]">
					<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={cols} k="name" className={TH}>Workspace</Sort_th><th className={TH}>Org</th><th className={TH}>Realm</th><th className={TH}>Daemons</th><th className={TH}>Teams</th><th className={TH}>Now</th><th className={TH}>Last run</th></tr></thead>
					<tbody>
						{read.status === 'loading' ? <Empty_row cols={7}>Loading…</Empty_row> : null}
						{d && !d.items.length ? <Empty_row cols={7}>{narrowed ? 'No workspaces run here.' : 'No workspaces yet.'}</Empty_row> : null}
						{d?.items.map((w) => (
							<tr key={w.id} className={TR} data-testid={`ws-${w.id}`}>
								<td className="px-4 py-2.5"><b>{w.name || w.path.split('/').pop() || w.id.slice(0, 8)}</b><div className="g-mono max-w-[340px] truncate text-[11.5px] text-[var(--g-ink-3)]" title={w.path}>{w.path}</div></td>
								<td className="px-4 text-[var(--g-ink-2)]"><Few items={(w.orgs ?? []).map((o) => o.slug)} /></td>
								<td className="px-4 text-[var(--g-ink-2)]"><Few items={(w.realms ?? []).map((r) => (r.org_slug && !org_id ? `${r.org_slug}.${r.slug}` : r.slug))} /></td>
								<td className="px-4 text-[var(--g-ink-2)]"><Few items={daemons_of(w)} /></td>
								<td className="px-4 text-[var(--g-ink-2)]"><Few items={w.teams} /></td>
								<td className="px-4">{w.active_runs ? <Pill tone="run">{w.active_runs} running</Pill> : <span className="text-[var(--g-ink-3)]">idle</span>}</td>
								<td className="px-4">{w.latest_run ? <div className="flex items-center gap-2"><State_pill state={w.latest_run.state} /><span className="text-[12px] text-[var(--g-ink-3)]">{w.latest_run.started_at ? `${ago(w.latest_run.started_at)} ago` : ''}</span></div> : <span className="text-[var(--g-ink-3)]">never</span>}</td>
							</tr>
						))}
					</tbody>
				</table>
				{d ? <Pager total={d.total} offset={p.offset} limit={LIMIT} on_change={(o) => p.set({ offset: o ? String(o) : null })} /> : null}
			</div>
		</div>
	);
}
