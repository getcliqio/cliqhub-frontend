/**
 * Admin › Activity › Logs — search run logs across every realm.
 * Read: `POST /v1/admin_list/get {kind:'logs'}` (→ runs/get_logs without realm_id, site admins only),
 * with counts per org, realm, team, run and daemon for the filters.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { use_bff_read } from '@/lib/use_bff_read';
import { run_href, type Admin_list_data, type Admin_log_row } from '@/lib/admin';
import { Admin_header, Chips, Facet_select, Pager, TABLE_WRAP, use_list_params } from '@/components/graphite/g_admin';
import { G_INPUT } from '@/components/graphite/g_agents';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

type Level = 'all' | 'error' | 'warn' | 'info' | 'debug';
type Range = '1h' | '24h' | '7d' | 'all';
const LIMIT = 100;
const LEVEL_CLS: Record<string, string> = { error: 'text-[var(--g-bad)]', warn: 'text-[var(--g-warn-text)]', info: 'text-[var(--g-ink-2)]', debug: 'text-[var(--g-ink-3)]' };

function stamp(ms: number): string {
	const d = new Date(ms);
	return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour12: false })}`;
}

export function Component() {
	const p = use_list_params();
	const level = (['error', 'warn', 'info', 'debug'].includes(p.get('level')) ? p.get('level') : 'all') as Level;
	const range = (['1h', '7d', 'all'].includes(p.get('range')) ? p.get('range') : '24h') as Range;
	const q = p.get('q');
	const run_id = p.get('run');
	const org_id = p.get('org');
	const realm_id = p.get('realm');
	const team = p.get('team');
	const daemon_id = p.get('daemon');
	const [draft, set_draft] = useState(q);
	const read = use_bff_read<Admin_list_data<Admin_log_row>>('/v1/admin_list/get', {
		kind: 'logs', filter: level, range, limit: LIMIT, offset: p.offset,
		...(q ? { query: q } : {}), ...(run_id ? { run_id } : {}), ...(org_id ? { org_id } : {}), ...(realm_id ? { realm_id } : {}), ...(team ? { team } : {}), ...(daemon_id ? { daemon_id } : {}),
	}, { fallback_error: 'Could not search logs.' });
	const f = read.data?.facets;
	const any_filter = Boolean(org_id || realm_id || team || run_id || daemon_id);
	const d = read.data;
	const c = d?.counts ?? {};
	return (
		<div className="flex flex-col gap-4">
			<Admin_header title="Logs" sub="Every line runs printed, across all orgs and realms. Narrow by org, realm, team, run or daemon to find what went wrong." />
			<div className="flex flex-wrap items-center gap-2">
				<Chips<Level> label="Level" value={level} on_change={(k) => p.set({ level: k === 'all' ? null : k })} options={[
					{ key: 'all', label: 'All', count: c.all },
					{ key: 'error', label: 'Errors', count: c.error, tone: 'bad' },
					{ key: 'warn', label: 'Warnings', count: c.warn, tone: 'warn' },
					{ key: 'info', label: 'Info', count: c.info },
					{ key: 'debug', label: 'Debug', count: c.debug },
				]} />
				<select aria-label="Time range" value={range} onChange={(e) => p.set({ range: e.target.value === '24h' ? null : e.target.value })} className={`${G_INPUT} w-[130px]`}>
					<option value="1h">Last hour</option><option value="24h">Last 24h</option><option value="7d">Last 7 days</option><option value="all">Any time</option>
				</select>
<form className="ml-auto" onSubmit={(e) => { e.preventDefault(); p.set({ q: draft.trim() || null }); }}>
					<input aria-label="Search logs" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Text in the log line" className={`${G_INPUT} w-[280px]`} />
				</form>
			</div>
			<div className="flex flex-wrap items-center gap-2" role="group" aria-label="Narrow by">
				<Facet_select label="Org" value={org_id} options={f?.org} on_change={(v) => p.set({ org: v, realm: null })} />
				<Facet_select label="Realm" value={realm_id} options={f?.realm} on_change={(v) => p.set({ realm: v })} />
				<Facet_select label="Team" value={team} options={f?.team} on_change={(v) => p.set({ team: v })} />
				<Facet_select label="Run" value={run_id} options={f?.run} on_change={(v) => p.set({ run: v })} width={200} />
				<Facet_select label="Daemon" value={daemon_id} options={f?.daemon} on_change={(v) => p.set({ daemon: v })} />
				{any_filter ? <button type="button" onClick={() => p.set({ org: null, realm: null, team: null, run: null, daemon: null })} className="text-[12.5px] text-[var(--g-acc)] hover:underline">Clear</button> : null}
			</div>
			{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="log search" /> : null}
			<div className={TABLE_WRAP}>
				{read.status === 'loading' ? <p className="px-4 py-10 text-center text-[13px] text-[var(--g-ink-3)]">Loading…</p> : null}
				{d && !d.items.length ? <p className="px-4 py-10 text-center text-[13px] text-[var(--g-ink-3)]">No log lines match.</p> : null}
				{d?.items.length ? (
					<ol className="g-mono divide-y divide-[var(--g-line-2)] text-[12px]">
						{d.items.map((l) => {
							const href = run_href(l.run_id, l.realm);
							return (
								<li key={l.id} className="grid grid-cols-[150px_52px_minmax(0,1fr)_minmax(0,260px)] items-start gap-3 px-4 py-1.5" data-testid={`log-${l.id}`}>
									<span className="text-[var(--g-ink-3)]">{stamp(l.created_at)}</span>
									<span className={`uppercase ${LEVEL_CLS[l.level] ?? ''}`}>{l.level}</span>
									<span className="whitespace-pre-wrap break-words text-[var(--g-ink)]">{l.message}</span>
									<span className="flex min-w-0 items-center justify-end gap-2 text-[var(--g-ink-3)]">
										<button type="button" onClick={() => p.set({ run: l.run_id })} className="min-w-0 truncate hover:text-[var(--g-ink)]" title="Only this run">{l.run_name || l.run_id.slice(0, 10)}</button>
										{href ? <Link to={href} className="shrink-0 text-[var(--g-acc)]">open</Link> : null}
									</span>
								</li>
							);
						})}
					</ol>
				) : null}
				{d ? <Pager total={d.total} offset={p.offset} limit={LIMIT} on_change={(o) => p.set({ offset: o ? String(o) : null })} /> : null}
			</div>
		</div>
	);
}
