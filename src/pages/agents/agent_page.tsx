/**
 * One agent (Graphite).
 *   Manage › Agents › <agent>  (/agents/:id)            org defaults, Realms, Used by, Manifest, Versions
 *   Realm › Agents › <agent>   (/o/:org/realms/:slug/agents/:id)  that realm's values (overrides)
 * Read: one `POST /v1/agent_page/get` per tab. Writes: agents/update_settings,
 * agents/deregister (custom agents; Core blocks while teams use it).
 */
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import yaml from 'js-yaml';
import { use_view_scope } from '@/lib/view_scope';
import { use_overview, relative_time } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { realm_path } from '@/lib/realm_url';
import { team_href } from '@/lib/team_page';
import { agent_href, agents_href, type Agent_page_data, type Agent_view } from '@/lib/agents';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Realm_nav } from '@/components/graphite/realm_nav';
import { Agent_tile, G_BTN, Kind_chip, Origin_badge, Settings_form, use_post } from '@/components/graphite/g_agents';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';
import { Sort_th, sort_rows, use_table_sort } from '@/components/graphite/g_sort';

const TABS: Array<{ id: Agent_view; label: string }> = [
	{ id: 'settings', label: 'Settings' }, { id: 'realms', label: 'Realms' }, { id: 'used_by', label: 'Used by' }, { id: 'manifest', label: 'Manifest' }, { id: 'versions', label: 'Versions' },
];
const H3 = 'flex items-center gap-2 border-b border-[var(--g-line)] px-4 py-2.5 text-[13.5px] font-semibold';
const CARD = 'overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]';
const team_chip = (label: string) => { const m = /^@?([^/]+)\/(.+)$/.exec(label); return m ? <Link key={label} to={team_href(m[1], m[2])} className="g-mono rounded border border-[var(--g-line)] px-1.5 py-0.5 text-[11.5px] text-[var(--g-ink-2)] hover:text-[var(--g-ink)]">@{m[1]}/{m[2]}</Link> : <span key={label} className="g-mono text-[11.5px]">{label}</span>; };

function Key_cell({ v }: { v: 'org' | 'realm' | 'missing' }) {
	if (v === 'org') return <span className="text-[var(--g-ink-3)]">↑ org</span>;
	if (v === 'realm') return <span className="text-[#8fb8ff]">● override</span>;
	return <span className="text-[var(--g-warn-text)]">○ missing</span>;
}

/** Shared body. `realm` set → realm-scoped (A7): only that realm's values + teams used there. */
export function Agent_detail({ org_id, org_slug, id, realm }: { org_id: string; org_slug: string | null; id: string; realm: { org_slug: string; slug: string } | null }) {
	const navigate = useNavigate();
	const post = use_post();
	const [search, set_search] = useSearchParams();
	const tab = realm ? 'settings' : (((v) => (TABS.some((t) => t.id === v) ? v : 'settings'))(search.get('tab')) as Agent_view);
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const [confirm, set_confirm] = useState<string | null>(null);
	const [busy, set_busy] = useState(false);
	const read = use_bff_read<Agent_page_data>('/v1/agent_page/get', { org_id, id, ...(tab !== 'settings' ? { view: tab } : {}), ...(realm ? { realm } : {}) }, { fallback_error: 'Could not load this agent.' });
	const d = read.data;
	// Each tab's table holds every row (realms of the org, teams, versions), so sorting here is exact.
	const realm_sort = use_table_sort({ keys: ['realm', 'used', 'ready'], mode: 'client', param: 'realms', first_dir: { used: 'desc', ready: 'desc' } });
	const team_sort = use_table_sort({ keys: ['team', 'version', 'installed'], mode: 'client', param: 'teams', first_dir: { installed: 'desc' } });
	const version_sort = use_table_sort({ keys: ['version', 'registered'], mode: 'client', param: 'versions', first_dir: { registered: 'desc' } });
	const go_tab = (t: Agent_view) => set_search((p) => { const n = new URLSearchParams(p); if (t === 'settings') n.delete('tab'); else n.set('tab', t); return n; }, { replace: true });

	async function remove(version_id: string, label: string) {
		set_busy(true); set_msg(null);
		const r = await post('/v1/agents/deregister', { org_id, id: version_id });
		set_busy(false); set_confirm(null);
		if (!r.ok) { set_msg({ tone: 'bad', text: r.error }); return; }
		set_msg({ tone: 'ok', text: `Removed ${label}.` });
		if (d && d.agent.versions.length <= 1) navigate(agents_href(org_slug, Boolean(org_slug))); else void read.reload();
	}

	if (read.status === 'error' && !d) return <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="agent" />;
	if (!d) return <div className="h-[360px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading agent" />;
	const a = d.agent;
	const used = sort_rows(d.used_by ?? [], team_sort, { team: (u) => `${u.scope}/${u.name}`, version: (u) => u.version, installed: (u) => u.realms.length });
	const realm_rows = sort_rows(d.realms ?? [], realm_sort, { realm: (r) => r.realm.slug, used: (r) => r.used_here.length, ready: (r) => (r.ready ? 1 : 0) });
	const versions = sort_rows(a.versions, version_sort, { version: (v) => v.version, registered: (v) => v.created_at });
	const in_use_block = /still referenced by team/i.test(msg?.text ?? '');

	let body: ReactNode = null;
	if (tab === 'settings') {
		body = (
			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
				{d.settings ? <Settings_form view={d.settings} org_id={org_id} agent_id={a.id} on_saved={(t) => { set_msg({ tone: 'ok', text: t }); void read.reload(); }} /> : <p className="text-[13px] text-[var(--g-ink-3)]">Settings couldn’t be loaded.</p>}
				<div className="flex flex-col gap-3">
					<div className={CARD} data-testid="used-card">
						<h3 className={H3}>{realm ? `Used in ${realm.slug}` : 'Why this matters'}<span className="text-[12px] font-normal text-[var(--g-ink-3)]">{d.used_by ? `${used.length} team${used.length === 1 ? '' : 's'}` : ''}</span></h3>
						<div className="px-4 py-3 text-[12.5px] leading-relaxed text-[var(--g-ink-2)]">
							{d.used_by === null ? 'Usage isn’t available from this Core.' : !used.length ? (realm ? 'No team installed here uses this agent.' : 'No team uses this agent yet.') : (
								<>
									{d.settings && !d.settings.ready ? <p className="mb-2">{used.length} team{used.length === 1 ? ' has' : 's have'} a <b className="g-mono">{a.name}</b> phase. Until the missing keys are set, their runs stop at that phase and ask.</p> : null}
									<div className="flex flex-wrap gap-1.5">{used.map((u) => team_chip(`${u.scope}/${u.name}`))}</div>
								</>
							)}
						</div>
					</div>
					{!realm ? (
						<div className={CARD} data-testid="overrides-card">
							<h3 className={H3}>Realm overrides<span className="text-[12px] font-normal text-[var(--g-ink-3)]">{d.overrides ? `${d.overrides.length} realm${d.overrides.length === 1 ? '' : 's'}` : ''}</span></h3>
							<div className="px-4 py-3 text-[12.5px] text-[var(--g-ink-2)]">
								{d.overrides?.length ? d.overrides.map((o) => (
									<div key={o.realm_id} className="flex items-center gap-2 py-0.5"><b>{o.realm_slug}</b><span className="text-[#8fb8ff]">overrides {o.keys.join(', ')}</span>{org_slug ? <Link to={`${realm_path(org_slug, o.realm_slug)}/agents/${a.id}`} className="ml-auto text-[var(--g-acc)]">Open →</Link> : null}</div>
								)) : <p className="text-[var(--g-ink-3)]">No realm overrides these values.</p>}
								<p className="mt-2 text-[var(--g-ink-3)]">Overrides are edited in each realm’s Agents page. <button type="button" onClick={() => go_tab('realms')} className="text-[var(--g-acc)]">See all realms →</button></p>
							</div>
						</div>
					) : (
						<div className={CARD}>
							<h3 className={H3}>Who can change this</h3>
							<p className="px-4 py-3 text-[12.5px] leading-relaxed text-[var(--g-ink-2)]">Realm overrides: roles with <span className="g-mono">agents.manage.realm</span> (operators) or <span className="g-mono">agents.manage</span>. Org defaults: <span className="g-mono">agents.manage</span>.</p>
						</div>
					)}
				</div>
			</div>
		);
	} else if (tab === 'realms') {
		body = (
			<>
				<div className={CARD} data-testid="realms-grid">
					{!d.realms?.length ? <p className="px-4 py-8 text-center text-[13px] text-[var(--g-ink-3)]">This org has no realms yet.</p> : (
						<table className="w-full text-[12.5px]">
							<thead><tr className="border-b border-[var(--g-line)] text-left text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]"><Sort_th sort={realm_sort} k="realm" className="px-4 py-2.5 font-semibold">Realm</Sort_th><Sort_th sort={realm_sort} k="used" className="px-4 font-semibold">Used here</Sort_th>{d.required_keys.map((k) => <th key={k} className="g-mono px-4 font-normal normal-case">{k}</th>)}<Sort_th sort={realm_sort} k="ready" className="px-4 font-semibold">Ready?</Sort_th><th /></tr></thead>
							<tbody>{realm_rows.map((r) => (
								<tr key={r.realm.id} className="border-b border-[var(--g-line-2,var(--g-line))] last:border-b-0" data-testid={`realm-${r.realm.slug}`}>
									<td className="px-4 py-2.5 font-semibold">{r.realm.slug}</td>
									<td className="px-4">{d.used_by === null ? '?' : r.used_here.length ? <><span>{r.used_here.length} team{r.used_here.length === 1 ? '' : 's'}</span><div className="g-mono text-[11px] text-[var(--g-ink-3)]">{r.used_here.map((t) => t.split('/')[1]).join(' · ')}</div></> : <span className="text-[var(--g-ink-3)]">not used</span>}</td>
									{d.required_keys.map((k) => <td key={k} className="px-4"><Key_cell v={r.keys[k] ?? 'missing'} /></td>)}
									<td className="px-4">{r.ready ? <span className="rounded-full bg-[var(--g-ok-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--g-ok)]">✓ Ready</span> : r.used_here.length ? <span className="rounded-full bg-[var(--g-warn-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--g-warn-text)]">! Not ready — runs will stop</span> : <span className="rounded-full bg-[var(--g-soft)] px-2 py-0.5 text-[11.5px] text-[var(--g-ink-3)]">Not ready</span>}</td>
									<td className="px-4 text-right">{org_slug ? <Link to={`${realm_path(org_slug, r.realm.slug)}/agents/${a.id}`} className="text-[12.5px] font-semibold text-[var(--g-acc)]">Open in {r.realm.slug} →</Link> : null}</td>
								</tr>
							))}</tbody>
						</table>
					)}
				</div>
				<p className="mt-2 text-[12.5px] text-[var(--g-ink-3)]">Realms where it’s used come first. Keys set in the org’s Settings tab apply to every realm that doesn’t override them.</p>
			</>
		);
	} else if (tab === 'used_by') {
		body = (
			<div className={CARD}>
				{d.used_by === null ? <p className="px-4 py-8 text-center text-[13px] text-[var(--g-ink-3)]">Usage isn’t available from this Core version.</p> : !used.length ? <p className="px-4 py-8 text-center text-[13px] text-[var(--g-ink-3)]">No team uses this agent.</p> : (
					<table className="w-full text-[12.5px]"><thead><tr className="border-b border-[var(--g-line)] text-left text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]"><Sort_th sort={team_sort} k="team" className="px-4 py-2.5 font-semibold">Team</Sort_th><Sort_th sort={team_sort} k="version" className="px-4 font-semibold">Version checked</Sort_th><Sort_th sort={team_sort} k="installed" className="px-4 font-semibold">Installed in</Sort_th></tr></thead>
						<tbody>{used.map((u) => <tr key={`${u.scope}/${u.name}`} className="border-b border-[var(--g-line-2,var(--g-line))] last:border-b-0"><td className="px-4 py-2.5"><Link to={team_href(u.scope, u.name)} className="g-mono font-semibold text-[var(--g-ink)] hover:underline">@{u.scope}/{u.name}</Link></td><td className="g-mono px-4">{u.version ?? '—'}</td><td className="px-4">{u.realms.length ? u.realms.map((r) => r.slug).join(', ') : <span className="text-[var(--g-ink-3)]">not installed</span>}</td></tr>)}</tbody></table>
				)}
			</div>
		);
	} else if (tab === 'manifest') {
		body = <pre className="g-mono max-h-[560px] overflow-auto rounded-[10px] border border-[var(--g-line)] bg-[#0e0f11] p-4 text-[12px] leading-relaxed text-[var(--g-ink-2)]" data-testid="manifest">{d.manifest ? yaml.dump(d.manifest, { lineWidth: 100 }) : 'No manifest.'}</pre>;
	} else {
		body = (
			<>
				<div className={CARD}>
					<table className="w-full text-[12.5px]"><thead><tr className="border-b border-[var(--g-line)] text-left text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]"><Sort_th sort={version_sort} k="version" className="px-4 py-2.5 font-semibold">Version</Sort_th><Sort_th sort={version_sort} k="registered" className="px-4 font-semibold">Registered</Sort_th><th /></tr></thead>
						<tbody>{versions.map((v) => (
							<tr key={v.id} className="border-b border-[var(--g-line-2,var(--g-line))] last:border-b-0">
								<td className="g-mono px-4 py-2.5 font-semibold">{v.version ?? '—'}{v.newest ? <span className="ml-2 font-sans text-[11.5px] font-normal text-[var(--g-ok)]">newest</span> : null}</td>
								<td className="px-4">{v.created_at ? relative_time(v.created_at) : '—'}</td>
								<td className="px-4 text-right">{a.is_system ? null : confirm === v.id
									? <span className="inline-flex items-center gap-2"><span className="text-[12px] text-[var(--g-ink-3)]">Remove {v.version}?</span><button type="button" disabled={busy} onClick={() => void remove(v.id, `${a.name} ${v.version ?? ''}`.trim())} className="rounded-md border border-[rgba(255,92,92,.5)] px-2.5 py-1 text-[12px] font-semibold text-[var(--g-bad)]">{busy ? 'Removing…' : 'Remove'}</button><button type="button" onClick={() => set_confirm(null)} className={G_BTN}>Cancel</button></span>
									: <button type="button" onClick={() => set_confirm(v.id)} className="rounded-md border border-[rgba(255,92,92,.45)] px-2.5 py-1 text-[12px] font-semibold text-[var(--g-bad)]">Remove</button>}</td>
							</tr>
						))}</tbody></table>
				</div>
				{in_use_block ? (
					<div role="alert" className="mt-3 rounded-[10px] border border-[rgba(255,92,92,.45)] bg-[rgba(255,92,92,.05)] px-4 py-3" data-testid="in-use">
						<b className="text-[#ff8b8b]">Can’t remove {a.name} yet</b>
						<p className="mt-1 text-[12.5px] text-[var(--g-ink-2)]">{msg!.text}. Change those phases to another agent (or delete the teams), then remove it.</p>
						{used.length ? <div className="mt-2 flex flex-wrap gap-2">{used.map((u) => <Link key={`${u.scope}/${u.name}`} to={`${team_href(u.scope, u.name)}?tab=workflow`} className={G_BTN}>Open {u.name}</Link>)}</div> : null}
					</div>
				) : null}
				<p className="mt-2 text-[12.5px] text-[var(--g-ink-3)]">{a.is_system ? 'Built-in agents can’t be removed — only their settings changed.' : 'Removing is blocked while any team still uses the agent.'}</p>
			</>
		);
	}

	return (
		<div className="flex flex-col gap-4" data-testid="agent-page">
			<div className="flex items-center gap-3.5">
				<Agent_tile agent_type={a.agent_type} name={a.name} size={44} />
				<div className="min-w-0">
					<div className="flex items-center gap-2"><h1 className="g-mono text-[21px] font-semibold">{a.name}</h1><Origin_badge is_system={a.is_system} /><span className="g-mono text-[var(--g-ink-3)]">{a.versions.map((v) => v.version).filter(Boolean).join(' · ')}</span></div>
					<div className="flex items-center gap-2 text-[13px] text-[var(--g-ink-3)]"><Kind_chip agent_type={a.agent_type} name={a.name} />{a.description ? <span>· {a.description}</span> : null}{realm && d.settings ? <span>· in {realm.slug} {d.settings.ready ? <span className="text-[var(--g-ok)]">✓ Ready</span> : <span className="text-[var(--g-warn-text)]">! Not ready</span>}</span> : null}</div>
				</div>
				{realm ? <Link to={agent_href(a.id, org_slug)} className="ml-auto text-[12.5px] font-semibold text-[var(--g-acc)]">Org settings for {a.name} →</Link> : null}
			</div>
			{!realm ? (
				<nav aria-label="Agent sections" className="flex gap-1 border-b border-[var(--g-line)]">
					{TABS.map((t) => <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => go_tab(t.id)} className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium ${tab === t.id ? 'border-[var(--g-acc)] text-[var(--g-ink)]' : 'border-transparent text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>{t.label}{t.id === 'used_by' && d.used_by ? <span className="g-mono ml-1 text-[11px] text-[var(--g-ink-3)]">{d.used_by.length}</span> : null}</button>)}
				</nav>
			) : null}
			{msg && !in_use_block ? <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`text-[12.5px] ${msg.tone === 'bad' ? 'text-[var(--g-bad)]' : 'text-[var(--g-ok)]'}`}>{msg.text}</p> : null}
			{body}
			{d.partial ? <p className="text-[12px] text-[var(--g-ink-3)]">Some details couldn’t be loaded.</p> : null}
		</div>
	);
}


export function Component() {
	const { id = '' } = useParams();
	const [search] = useSearchParams();
	const overview = use_overview();
	const orgs = overview.data?.orgs ?? [];
	// The org you're in (the shell's switcher), like every other org page.
	const org = use_view_scope(overview.data).org;
	return (
		<Graphite_shell
			data={overview.data}
			title="Agents"
			actions={<Link to={agents_href(org?.slug ?? null, orgs.length > 1)} className="inline-flex h-8 items-center rounded-lg border border-[var(--g-line)] px-3 text-[12.5px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">All agents</Link>}
		>
			<div className="px-7 py-6">
				{org ? <Agent_detail org_id={org.id} org_slug={org.slug} id={id} realm={null} /> : overview.status === 'loading' ? null : <p className="text-[13px] text-[var(--g-ink-3)]">No organization.</p>}
			</div>
		</Graphite_shell>
	);
}

