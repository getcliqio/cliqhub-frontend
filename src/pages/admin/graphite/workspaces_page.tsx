/**
 * Admin › Fleet › Workspaces — every registered workspace and what's running in it.
 * Read: `POST /v1/admin_list/get {kind:'workspaces'}`.
 */
import { use_bff_read } from '@/lib/use_bff_read';
import { ago, type Admin_list_data, type Admin_workspace_row } from '@/lib/admin';
import { Admin_header, Empty_row, Pager, Pill, TABLE_WRAP, TH, TR, use_list_params } from '@/components/graphite/g_admin';
import { State_pill } from '@/components/graphite/g_status';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

const LIMIT = 25;

export function Component() {
	const p = use_list_params();
	const read = use_bff_read<Admin_list_data<Admin_workspace_row>>('/v1/admin_list/get', { kind: 'workspaces', limit: LIMIT, offset: p.offset }, { refresh_ms: 30_000, fallback_error: 'Could not load workspaces.' });
	const d = read.data;
	return (
		<div className="flex flex-col gap-4">
			<Admin_header title="Workspaces" sub={d ? `${d.total.toLocaleString('en-US')} workspace${d.total === 1 ? '' : 's'} registered by daemons.` : 'Every workspace registered by a daemon.'} />
			{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="workspaces list" /> : null}
			<div className={TABLE_WRAP}>
				<table className="w-full text-[13px]">
					<thead><tr className="border-b border-[var(--g-line)]"><th className={TH}>Workspace</th><th className={TH}>Daemon</th><th className={TH}>Teams</th><th className={TH}>Now</th><th className={TH}>Last run</th></tr></thead>
					<tbody>
						{read.status === 'loading' ? <Empty_row cols={5}>Loading…</Empty_row> : null}
						{d && !d.items.length ? <Empty_row cols={5}>No workspaces yet.</Empty_row> : null}
						{d?.items.map((w) => (
							<tr key={w.id} className={TR} data-testid={`ws-${w.id}`}>
								<td className="px-4 py-2.5"><b>{w.name || w.path.split('/').pop() || w.id.slice(0, 8)}</b><div className="g-mono max-w-[380px] truncate text-[11.5px] text-[var(--g-ink-3)]" title={w.path}>{w.path}</div></td>
								<td className="g-mono px-4 text-[var(--g-ink-2)]">{w.daemon_name ?? (w.daemon_id ? w.daemon_id.slice(0, 10) : '—')}</td>
								<td className="px-4 text-[var(--g-ink-2)]">{w.teams.length ? <span className="g-mono text-[12px]">{w.teams.slice(0, 2).join(', ')}{w.teams.length > 2 ? ` +${w.teams.length - 2}` : ''}</span> : <span className="text-[var(--g-ink-3)]">—</span>}</td>
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
