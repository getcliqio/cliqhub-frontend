/**
 * Manage › Agents (Graphite). Read: one `POST /v1/agent_list/get` (BFF:
 * catalog + org setup + realm overrides + which teams use each agent).
 * Writes: agents/register (dialog). Follows the view switcher's org; in the
 * all-orgs view, pick the org here.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Plus, RefreshCw } from 'lucide-react';
import { use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { use_view_scope } from '@/lib/view_scope';
import { agent_href, agent_kind, type Agent_list_data, type Agent_list_row } from '@/lib/agents';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Agent_tile, G_INPUT, G_PILL, G_PRIMARY, Kind_chip, Origin_badge, Register_dialog, Setup_badge } from '@/components/graphite/g_agents';
import { Sort_th, sort_rows, use_table_sort } from '@/components/graphite/g_sort';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

type Filter = 'all' | 'needs_setup' | 'in_use' | 'custom' | 'builtin';
const FILTERS: Array<{ id: Filter; label: string }> = [
	{ id: 'all', label: 'All' }, { id: 'needs_setup', label: 'Needs setup' }, { id: 'in_use', label: 'In use' }, { id: 'custom', label: 'Custom' }, { id: 'builtin', label: 'Built-in' },
];

export function matches(r: Agent_list_row, f: Filter, q: string, kind: string): boolean {
	if (q && !`${r.name} ${r.description ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
	if (kind && agent_kind(r.agent_type, r.name).id !== kind) return false;
	if (f === 'needs_setup') return Boolean(r.setup && r.setup.required_total > 0 && !r.setup.ready);
	if (f === 'in_use') return (r.used_count ?? 0) > 0;
	if (f === 'custom') return !r.is_system;
	if (f === 'builtin') return r.is_system;
	return true;
}

export function Component() {
	const overview = use_overview();
	const navigate = useNavigate();
	const [search, set_search] = useSearchParams();
	const scope = use_view_scope(overview.data);
	const orgs = overview.data?.orgs ?? [];
	const view_org = scope.kind === 'org' ? scope.org : scope.kind === 'realm' ? orgs.find((o) => o.id === scope.realm.org_id) ?? null : null;
	const org = view_org;
	const f = ((v) => (FILTERS.some((x) => x.id === v) ? v : 'all'))(search.get('filter')) as Filter;
	const [q, set_q] = useState('');
	const [kind, set_kind] = useState('');
	const [registering, set_registering] = useState(false);

	const read = use_bff_read<Agent_list_data>('/v1/agent_list/get', org ? { org_id: org.id } : null, { fallback_error: 'Could not load agents.' });
	const data = read.data;
	// The BFF returns the org's whole agent list (no paging), so sorting here is exact.
	const sort = use_table_sort({ keys: ['name', 'kind', 'setup', 'used'], mode: 'client', first_dir: { used: 'desc' } });
	const rows = sort_rows((data?.items ?? []).filter((r) => matches(r, f, q, kind)), sort, {
		name: (r) => r.name,
		kind: (r) => agent_kind(r.agent_type, r.name).label,
		// Needs setup first when ascending: not ready (0) < ready (1) < nothing to set up (null → last).
		setup: (r) => (r.setup && r.setup.required_total > 0 ? (r.setup.ready ? 1 : 0) : null),
		used: (r) => r.used_count,
	});
	const kinds = useMemo(() => [...new Map((data?.items ?? []).map((r) => { const k = agent_kind(r.agent_type, r.name); return [k.id, k.label]; })).entries()], [data]);
	const set_param = (k: string, v: string | null) => set_search((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
	const count = (id: Filter) => (id === 'all' ? data?.counts.all : id === 'needs_setup' ? data?.counts.needs_setup : id === 'in_use' ? data?.counts.in_use : id === 'custom' ? data?.counts.custom : data?.counts.builtin);
	const existing = useMemo(() => new Map((data?.items ?? []).map((r) => [r.name, r.versions])), [data]);
	const first_blocking = data?.attention ? data.items.find((r) => r.name === data.attention!.agents[0]) : null;

	return (
		<Graphite_shell
			data={overview.data}
			title="Agents"
			actions={
				<>
					<button type="button" onClick={() => void read.reload()} aria-label="Refresh" title="Refresh" className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><RefreshCw className="h-3.5 w-3.5" /></button>
					<button type="button" disabled={!org} onClick={() => set_registering(true)} className={G_PRIMARY}><Plus aria-hidden className="h-3.5 w-3.5" />Register custom agent</button>
				</>
			}
		>
			<div className="flex flex-col gap-4 px-7 py-6">
				<div className="flex items-end gap-3">
					<div>
						<h1 className="text-[22px] font-semibold tracking-tight">Agents</h1>
						<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">What your teams’ phases run on{org ? ` in ${org.display_name}` : ''}. Set keys once for the org — any realm can override them.</p>
					</div>
				</div>

				{!org && overview.status !== 'loading' ? <p className="text-[13px] text-[var(--g-ink-3)]">Agents belong to an organization — join or create one first.</p> : null}
				{read.status === 'error' && !data ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="agents" /> : null}

				{data?.attention ? (
					<div role="status" className="flex items-center gap-4 rounded-[10px] border border-[rgba(255,178,36,.4)] bg-[linear-gradient(90deg,rgba(255,178,36,.07),transparent)] px-4 py-3" data-testid="attention">
						<span aria-hidden className="text-[18px]">⚠</span>
						<div>
							<b>{data.attention.agents.length} agent{data.attention.agents.length === 1 ? '' : 's'} in use {data.attention.agents.length === 1 ? 'is' : 'are'} missing keys</b>
							<p className="text-[12.5px] text-[var(--g-ink-3)]">Runs that reach a phase using {data.attention.agents.map((a, i) => <span key={a}>{i ? (i === data.attention!.agents.length - 1 ? ' or ' : ', ') : ''}<span className="g-mono">{a}</span></span>)} will stop and ask. {data.attention.teams} team{data.attention.teams === 1 ? '' : 's'} affected.</p>
						</div>
						{first_blocking ? <button type="button" onClick={() => navigate(agent_href(first_blocking.id, org?.slug ?? null))} className={`${G_PRIMARY} ml-auto`}>Fix now</button> : null}
					</div>
				) : null}

				<div className="flex flex-wrap items-center gap-2">
					<div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
						{FILTERS.map((x) => { const n = count(x.id); return (
							<button key={x.id} type="button" aria-pressed={f === x.id} onClick={() => set_param('filter', x.id === 'all' ? null : x.id)} className={G_PILL(f === x.id)}>
								{x.label}{n !== null && n !== undefined ? <span className={`g-mono text-[11px] ${x.id === 'needs_setup' && n ? 'text-[var(--g-warn-text)]' : 'text-[var(--g-ink-3)]'}`}>{n}</span> : null}
							</button>
						); })}
					</div>
					<select aria-label="Kind" value={kind} onChange={(e) => set_kind(e.target.value)} className={`${G_INPUT} w-[150px]`}><option value="">Kind: all</option>{kinds.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
					<input aria-label="Search agents" value={q} onChange={(e) => set_q(e.target.value)} placeholder="Search agents…" className={`${G_INPUT} ml-auto w-[260px]`} />
				</div>

				<div className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
					{read.status === 'loading' ? <div className="h-[320px] animate-pulse" aria-busy="true" aria-label="Loading agents" /> : null}
					{data && !rows.length ? <p className="px-4 py-10 text-center text-[13px] text-[var(--g-ink-3)]">{data.items.length ? 'No agents match.' : 'No agents yet.'}</p> : null}
					{rows.length ? (
						<table className="w-full text-[12.5px]">
							<thead><tr className="border-b border-[var(--g-line)] text-left text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]"><Sort_th sort={sort} k="name" className="px-4 py-2.5 font-semibold">Agent</Sort_th><Sort_th sort={sort} k="kind" className="px-4 font-semibold">Kind</Sort_th><th className="px-4 font-semibold">Version</th><Sort_th sort={sort} k="setup" className="px-4 font-semibold">Setup (org)</Sort_th><th className="px-4 font-semibold">Realm overrides</th><Sort_th sort={sort} k="used" className="px-4 font-semibold">Used by</Sort_th><th className="w-[1%]" /></tr></thead>
							<tbody>
								{rows.map((r) => (
									<tr key={r.id} className="cursor-pointer border-b border-[var(--g-line-2,var(--g-line))] last:border-b-0 hover:bg-[var(--g-soft)]" onClick={() => navigate(agent_href(r.id, org?.slug ?? null))} data-testid={`agent-${r.name}`}>
										<td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><Agent_tile agent_type={r.agent_type} name={r.name} /><div className="min-w-0"><div className="flex items-center gap-1.5"><Link to={agent_href(r.id, org?.slug ?? null)} onClick={(e) => e.stopPropagation()} className="g-mono text-[13px] font-semibold text-[var(--g-ink)] hover:underline">{r.name}</Link><Origin_badge is_system={r.is_system} /></div><div className="truncate text-[12px] text-[var(--g-ink-3)]">{r.description}</div></div></div></td>
										<td className="px-4"><Kind_chip agent_type={r.agent_type} name={r.name} /></td>
										<td className="g-mono px-4 text-[12px]">{r.version ?? '—'}{r.versions.length > 1 ? <span className="text-[var(--g-ink-3)]"> +{r.versions.length - 1}</span> : null}</td>
										<td className="px-4"><Setup_badge setup={r.setup} used={r.used_count} /></td>
										<td className="px-4">{r.overrides.length ? <span className="flex flex-wrap gap-1">{r.overrides.map((o) => <span key={o.realm_id} title={o.keys.join(', ')} className="g-mono rounded border border-[rgba(91,157,255,.45)] px-1.5 text-[11px] text-[var(--g-ink-2)]">{o.realm_slug}</span>)}</span> : <span className="text-[var(--g-ink-3)]">—</span>}</td>
										<td className="px-4">{r.used_count === null ? <span className="text-[var(--g-ink-3)]" title="Core doesn’t report usage">?</span> : r.used_count ? `${r.used_count} team${r.used_count === 1 ? '' : 's'}` : <span className="text-[var(--g-ink-3)]">—</span>}</td>
										<td className="px-4 text-right">{r.setup && r.setup.required_total > 0 && !r.setup.ready && (r.used_count ?? 1) > 0 ? <span className={`${G_PRIMARY} px-2.5 py-1`}>Set up</span> : <span className="text-[var(--g-ink-3)]">›</span>}</td>
									</tr>
								))}
							</tbody>
						</table>
					) : null}
				</div>
				{data?.partial ? <p className="text-[12px] text-[var(--g-ink-3)]">Some details couldn’t be loaded{data.realms_total > data.realms_checked ? ` (overrides checked in ${data.realms_checked} of ${data.realms_total} realms)` : ''}.</p> : null}
				<p className="text-[12px] text-[var(--g-ink-3)]">Looking for a realm’s view? Open the realm → <b>Agents</b>.</p>
			</div>
			{registering && org ? (
				<Register_dialog org_id={org.id} org_label={org.display_name} existing={existing} on_close={() => set_registering(false)} on_done={(a) => { set_registering(false); void read.reload(); if (a.id) navigate(agent_href(a.id, org.slug)); }} />
			) : null}
		</Graphite_shell>
	);
}
