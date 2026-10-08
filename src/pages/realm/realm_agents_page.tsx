/**
 * Realm › Agents (Graphite).
 *   /o/:org/realms/:slug/agents       what this realm's agents run with (A6)
 *   /o/:org/realms/:slug/agents/:id   one agent: inherit or override per key (A7)
 * Read: one `POST /v1/agent_list/get {realm}` / `POST /v1/agent_page/get {realm}`.
 * Writes: agents/update_settings with realm_id (the realm's overrides only).
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { realm_path } from '@/lib/realm_url';
import type { Agent_list_data, Agent_list_row } from '@/lib/agents';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Realm_nav } from '@/components/graphite/realm_nav';
import { Agent_tile, G_INPUT, G_PILL, G_PRIMARY, Setup_badge } from '@/components/graphite/g_agents';
import { Sort_th, sort_rows, use_table_sort } from '@/components/graphite/g_sort';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';
import { Agent_detail } from '@/pages/agents/agent_page';
import { ROW_OPENS, use_row_open } from '@/components/graphite/g_row';

type Filter = 'used' | 'not_ready' | 'overridden' | 'all';

function Values_cell({ r, realm }: { r: Agent_list_row; realm: string }) {
	if (!r.setup || !r.setup.has_settings) return <span className="text-[var(--g-ink-3)]">no settings</span>;
	const keys = r.overrides.find((o) => o.realm_slug === realm)?.keys ?? [];
	if (keys.length) return <span><span className="text-[var(--g-run-text)]">overrides {keys.join(', ')}</span>{r.setup.ready ? <span className="text-[var(--g-ink-3)]"> · rest from org</span> : null}</span>;
	if (!r.setup.ready) return <span className="text-[var(--g-warn-text)]">{r.setup.required_total - r.setup.required_configured} required key{r.setup.required_total - r.setup.required_configured === 1 ? '' : 's'} missing</span>;
	return <span className="text-[var(--g-ink-3)]">↑ all from org</span>;
}

export function Component() {
	const row = use_row_open();
	const { org = '', slug = '', id } = useParams();
	const overview = use_overview();
	const navigate = useNavigate();
	const realm_ov = overview.data?.orgs.flatMap((o) => o.realms).find((r) => r.org_slug === org && r.slug === slug) ?? null;
	const org_id = realm_ov?.org_id ?? overview.data?.orgs.find((o) => o.slug === org)?.id ?? null;
	const [f, set_f] = useState<Filter>('used');
	const [q, set_q] = useState('');
	const base = realm_path(org, slug);
	const read = use_bff_read<Agent_list_data>('/v1/agent_list/get', !id && org_id ? { org_id, realm: { org_slug: org, slug } } : null, { fallback_error: 'Could not load agents.' });
	const data = read.data;
	// The BFF returns the org's whole agent list for this realm (no paging), so sorting here is exact.
	const sort = use_table_sort({ keys: ['name', 'used', 'ready'], mode: 'client', first_dir: { used: 'desc' } });
	const filtered = useMemo(() => (data?.items ?? []).filter((r) => {
		if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false;
		if (f === 'used') return data?.counts.in_use === null ? true : (r.used_count ?? 0) > 0;
		if (f === 'not_ready') return Boolean(r.setup && r.setup.required_total > 0 && !r.setup.ready);
		if (f === 'overridden') return r.overrides.length > 0;
		return true;
	}), [data, f, q]);
	// Ready ascending puts agents that still need keys first; agents with nothing to set up sort last.
	const rows = sort_rows(filtered, sort, { name: (r) => r.name, used: (r) => r.used_count, ready: (r) => (r.setup && r.setup.required_total > 0 ? (r.setup.ready ? 1 : 0) : null) });
	const counts: Record<Filter, number | null> = {
		used: data?.counts.in_use ?? null,
		not_ready: data ? data.items.filter((r) => r.setup && r.setup.required_total > 0 && !r.setup.ready && (r.used_count ?? 1) > 0).length : null,
		overridden: data ? data.items.filter((r) => r.overrides.length > 0).length : null,
		all: data?.counts.all ?? null,
	};
	const first = data?.attention ? data.items.find((r) => r.name === data.attention!.agents[0]) : null;

	return (
		<Graphite_shell
			data={overview.data}
			current_realm_id={realm_ov?.id ?? null}
			title="Agents"
			actions={!id ? <button type="button" onClick={() => void read.reload()} aria-label="Refresh" title="Refresh" className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><RefreshCw className="h-3.5 w-3.5" /></button> : null}
		>
			<Realm_nav org_slug={org} slug={slug} realm={realm_ov} />
			<div className="flex flex-col gap-4 px-7 py-6">
				{!org_id && overview.status !== 'loading' ? <p className="text-[13px] text-[var(--g-ink-3)]">Realm not found.</p> : null}
				{id && org_id ? (
					<>
						<Link to={`${base}/agents`} className="text-[12.5px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">← {slug} agents</Link>
						<Agent_detail org_id={org_id} org_slug={org} id={id} realm={{ org_slug: org, slug }} />
					</>
				) : org_id ? (
					<>
						<p className="text-[13px] text-[var(--g-ink-3)]">What {slug}’s agents run with. Values come from the org’s defaults unless this realm overrides them.</p>
						{read.status === 'error' && !data ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="realm" /> : null}
						{data?.attention && first ? (
							<div role="status" data-testid="attention" className="flex items-center gap-4 rounded-[10px] border border-[rgba(255,178,36,.4)] bg-[linear-gradient(90deg,rgba(255,178,36,.07),transparent)] px-4 py-3">
								<span aria-hidden className="text-[18px]">⚠</span>
								<div><b>{data.attention.agents.length === 1 ? <><span className="g-mono">{first.name}</span> is missing keys here</> : `${data.attention.agents.length} agents are missing keys here`}</b>
									<p className="text-[12.5px] text-[var(--g-ink-3)]">{data.attention.teams} team{data.attention.teams === 1 ? '' : 's'} installed in {slug} use {data.attention.agents.length === 1 ? 'it' : 'them'}; those phases will stop and ask.</p></div>
								<button type="button" onClick={() => navigate(`${base}/agents/${first.id}`)} className={`${G_PRIMARY} ml-auto`}>Set up</button>
							</div>
						) : null}
						<div className="flex flex-wrap items-center gap-2">
							<div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
								{([['used', `Used in ${slug}`], ['not_ready', 'Not ready'], ['overridden', 'Overridden here'], ['all', 'All agents']] as Array<[Filter, string]>).map(([k, l]) => (
									<button key={k} type="button" aria-pressed={f === k} onClick={() => set_f(k)} className={G_PILL(f === k)}>{l}{counts[k] !== null ? <span className={`g-mono text-[11px] ${k === 'not_ready' && counts[k] ? 'text-[var(--g-warn-text)]' : 'text-[var(--g-ink-3)]'}`}>{counts[k]}</span> : null}</button>
								))}
							</div>
							<input aria-label="Search agents" value={q} onChange={(e) => set_q(e.target.value)} placeholder="Search agents…" className={`${G_INPUT} ml-auto w-[240px]`} />
						</div>
						<div className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
							{read.status === 'loading' ? <div className="h-[300px] animate-pulse" aria-busy="true" aria-label="Loading agents" /> : null}
							{data && !rows.length ? <p className="px-4 py-10 text-center text-[13px] text-[var(--g-ink-3)]">{f === 'used' ? `No team installed in ${slug} uses an agent yet.` : 'Nothing here.'}</p> : null}
							{rows.length ? (
								<table className="w-full text-[12.5px]">
									<thead><tr className="border-b border-[var(--g-line)] text-left text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]"><Sort_th sort={sort} k="name" className="px-4 py-2.5 font-semibold">Agent</Sort_th><Sort_th sort={sort} k="used" className="px-4 font-semibold">Used by (here)</Sort_th><th className="px-4 font-semibold">Values</th><Sort_th sort={sort} k="ready" className="px-4 font-semibold">Ready?</Sort_th><th className="w-[1%]" /></tr></thead>
									<tbody>{rows.map((r) => (
										<tr key={r.id} {...row({ to: `${base}/agents/${r.id}` })} className={`border-b border-[var(--g-line-2,var(--g-line))] last:border-b-0 ${ROW_OPENS}`} data-testid={`ragent-${r.name}`}>
											<td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><Agent_tile agent_type={r.agent_type} name={r.name} size={28} /><Link to={`${base}/agents/${r.id}`} onClick={(e) => e.stopPropagation()} className="g-mono font-semibold text-[var(--g-ink)] hover:underline">{r.name}</Link></div></td>
											<td className="px-4">{r.used_count === null ? '?' : r.used_count ? `${r.used_count} team${r.used_count === 1 ? '' : 's'}` : <span className="text-[var(--g-ink-3)]">—</span>}</td>
											<td className="px-4"><Values_cell r={r} realm={slug} /></td>
											<td className="px-4"><Setup_badge setup={r.setup} used={r.used_count} /></td>
											<td className="px-4 text-right">{r.setup && r.setup.required_total > 0 && !r.setup.ready && (r.used_count ?? 1) > 0 ? <span className={`${G_PRIMARY} px-2.5 py-1`}>Set up</span> : <span className="text-[var(--g-ink-3)]">›</span>}</td>
										</tr>
									))}</tbody>
								</table>
							) : null}
						</div>
						<p className="text-[12px] text-[var(--g-ink-3)]">Org defaults for every realm live in <Link to={`/agents?org=${encodeURIComponent(org)}`} className="text-[var(--g-acc)]">Manage › Agents</Link>.</p>
					</>
				) : null}
			</div>
		</Graphite_shell>
	);
}
