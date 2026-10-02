/**
 * Admin › Activity › Audit log (AD6) — who did what, to whom.
 * Read: `POST /v1/admin_list/get {kind:'audit'}` (→ /internal/reports/audit).
 * Time and target filters need Core API 3; the BFF reports them as unsupported otherwise.
 */
import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router';
import { use_bff_read } from '@/lib/use_bff_read';
import { audit_details, audit_is_sensitive, audit_sentence, audit_summary, type Admin_audit_row, type Admin_list_data } from '@/lib/admin';
import { Admin_header, Avatar, Chips, Empty_row, Facet_select, Pager, TABLE_WRAP, TH, TR } from '@/components/graphite/g_admin';
import { Sort_th, use_table_sort } from '@/components/graphite/g_sort';
import { G_INPUT } from '@/components/graphite/g_agents';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

type Range = 'all' | '24h' | '7d' | '30d';
const RANGE_MS: Record<Exclude<Range, 'all'>, number> = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 };
const LIMIT = 50;
const SECRET_KEY = /(^|_)(key|token|secret|password)$/i;

function when(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	const today = new Date();
	return d.toDateString() === today.toDateString()
		? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
		: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Details as JSON, with secret-looking keys reduced to set/unset. */
function safe_details(details: Admin_audit_row['details']): string {
	return JSON.stringify(audit_details(details), (k, v) => (k && SECRET_KEY.test(k) ? (v ? 'set' : 'unset') : v), 2);
}

export function Component() {
	const [sp, set_sp] = useSearchParams();
	const range = (['24h', '7d', '30d'].includes(sp.get('range') ?? '') ? sp.get('range') : 'all') as Range;
	const action = sp.get('action') ?? '';
	const target_type = sp.get('type') ?? '';
	const target = sp.get('target') ?? '';
	const admin_id = sp.get('admin') ?? '';
	const offset = Number(sp.get('offset') ?? 0) || 0;
	const [open, set_open] = useState<string | null>(null);
	const [draft, set_draft] = useState({ target });
	// Round to the minute so polling doesn't produce a new request body each render.
	const since_ms = range === 'all' ? undefined : Math.floor((Date.now() - RANGE_MS[range]) / 60_000) * 60_000;
	const sort = use_table_sort({ keys: ['created_at', 'action'], default_sort: { by: 'created_at', dir: 'desc' }, first_dir: { created_at: 'desc' } });
	const read = use_bff_read<Admin_list_data<Admin_audit_row> & { unsupported: string[] }>('/v1/admin_list/get', {
		kind: 'audit', limit: LIMIT, offset, ...sort.body,
		...(since_ms != null ? { since_ms } : {}),
		...(action ? { action } : {}), ...(target_type ? { target_type } : {}), ...(target ? { target_id: target } : {}), ...(admin_id ? { admin_id } : {}),
	}, { fallback_error: 'Could not load the audit log.' });
	const cols = sort.with_sortable(read.data?.sortable);
	const d = read.data;
	const set = (patch: Record<string, string | null>) => {
		const n = new URLSearchParams(sp);
		for (const [k, v] of Object.entries(patch)) { if (!v) n.delete(k); else n.set(k, v); }
		n.delete('offset');
		set_sp(n, { replace: true });
	};
	const unsupported = d?.unsupported ?? [];

	return (
		<div className="flex flex-col gap-4">
			<Admin_header title="Audit log" sub="Every change a site admin made — accounts, orgs, scopes and teams — with who did it and when. Click a row for the full record." />
			<div className="flex flex-wrap items-center gap-2">
				<Chips<Range> label="Time range" value={range} on_change={(k) => set({ range: k === 'all' ? null : k })} options={[{ key: 'all', label: 'Any time' }, { key: '24h', label: '24h' }, { key: '7d', label: '7 days' }, { key: '30d', label: '30 days' }]} />
				<Facet_select label="Action" value={action} options={d?.facets?.action} on_change={(v) => set({ action: v })} width={190} />
				<Facet_select label="Target" value={target_type} options={d?.facets?.target_type} on_change={(v) => set({ type: v })} width={150} />
				<Facet_select label="Admin" value={admin_id} options={d?.facets?.admin} on_change={(v) => set({ admin: v })} width={160} />
				<form className="ml-auto flex gap-2" onSubmit={(e) => { e.preventDefault(); set({ target: draft.target.trim() || null }); }}>
					<input aria-label="Target id" value={draft.target} onChange={(e) => set_draft({ target: e.target.value })} placeholder="Target id or slug" className={`${G_INPUT} w-[200px]`} />
					<button type="submit" className="sr-only">Apply</button>
				</form>
			</div>
			{unsupported.length ? <p role="note" className="text-[12px] text-[var(--g-warn-text)]">{unsupported.map((u) => (u === 'since' ? 'Time range' : 'Target id')).join(' and ')} filter{unsupported.length > 1 ? 's' : ''} need{unsupported.length > 1 ? '' : 's'} Core API 3 — showing results without {unsupported.length > 1 ? 'them' : 'it'}.</p> : null}
			{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="audit log" /> : null}
			<div className={TABLE_WRAP}>
				<table className="w-full text-[13px]">
					<thead><tr className="border-b border-[var(--g-line)]"><Sort_th sort={cols} k="created_at" className={TH}>When</Sort_th><th className={TH}>Who</th><Sort_th sort={cols} k="action" className={TH}>What happened</Sort_th><th className={TH}>Details</th></tr></thead>
					<tbody>
						{read.status === 'loading' ? <Empty_row cols={4}>Loading…</Empty_row> : null}
						{d && !d.items.length ? <Empty_row cols={4}>No matching entries.</Empty_row> : null}
						{d?.items.map((e) => (
							<Fragment key={e.id}>
								<tr onClick={() => set_open(open === e.id ? null : e.id)} aria-expanded={open === e.id} className={`${TR} cursor-pointer hover:bg-[var(--g-soft)] ${open === e.id ? 'bg-[var(--g-soft)]' : ''}`} data-testid={`audit-${e.id}`}>
									<td className="g-mono whitespace-nowrap px-4 py-2.5 text-[var(--g-ink-3)]">{when(e.created_at)}</td>
									<td className="px-4"><div className="flex items-center gap-2"><Avatar name={e.admin_username ?? '?'} size={22} />{e.admin_username ?? <span className="text-[var(--g-ink-3)]">deleted user</span>}</div></td>
									<td className="px-4"><span className={audit_is_sensitive(e.action) ? 'text-[#ff9f5a]' : ''}>{audit_sentence(e)}</span> <span className="g-mono ml-1 text-[11px] text-[var(--g-ink-3)]">{e.action}</span></td>
									<td className="max-w-[360px] truncate px-4 text-[var(--g-ink-2)]">{audit_summary(e.details)}</td>
								</tr>
								{open === e.id ? (
									<tr className={TR}><td colSpan={4} className="bg-[var(--g-bg)] px-4 py-3"><pre className="g-mono whitespace-pre-wrap break-words text-[12px] text-[var(--g-ink-2)]">{`id ${e.id} · admin ${e.admin_id} · target ${e.target_type}:${e.target_id}\n`}{safe_details(e.details)}</pre></td></tr>
								) : null}
							</Fragment>
						))}
					</tbody>
				</table>
				{d ? <Pager total={d.total} offset={offset} limit={LIMIT} on_change={(o) => { const n = new URLSearchParams(sp); if (o) n.set('offset', String(o)); else n.delete('offset'); set_sp(n, { replace: true }); }} /> : null}
			</div>
		</div>
	);
}
