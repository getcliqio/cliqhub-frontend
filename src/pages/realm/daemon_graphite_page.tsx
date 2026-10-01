/**
 * Realm › Daemon (Graphite) — /o/:org/realms/:slug/daemons/:daemon_id
 * Read: one `POST /v1/daemon_page/get` (BFF: realm gate, daemons/get_by_id,
 * live installed teams, realm roster, workspaces, recent runs).
 * Writes (Core): teams/install · teams/uninstall · runs/enqueue · runs/cancel · daemons/remove.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { use_overview, relative_time } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { realm_path } from '@/lib/realm_url';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Realm_nav } from '@/components/graphite/realm_nav';
import { Banner, Empty_row, TABLE_WRAP, TH, TR } from '@/components/graphite/g_admin';
import { G_BTN, G_INPUT, G_PRIMARY, use_post } from '@/components/graphite/g_agents';
import { Daemon_status, G_DANGER, Host_runs, Run_here, Run_state, team_label, type Daemon_page_data, type Host_team } from '@/components/graphite/g_host';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

type Msg = { tone: 'ok' | 'bad'; text: string } | null;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
	return <div className="min-w-0"><div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]">{label}</div><div className="mt-0.5 truncate text-[13px]">{children}</div></div>;
}

function Teams({ data, reload }: { data: Daemon_page_data; reload: () => Promise<void> }) {
	const post = use_post();
	const daemon_id = String(data.daemon.id ?? '');
	const [pick, set_pick] = useState('');
	const [confirm, set_confirm] = useState<string | null>(null);
	const [msg, set_msg] = useState<Msg>(null);
	const [busy, set_busy] = useState(false);
	async function install() {
		if (!pick) return;
		set_busy(true); set_msg(null);
		const r = await post('/v1/teams/install', { team_id: pick, daemon_ids: [daemon_id] });
		set_busy(false);
		if (!r.ok) { set_msg({ tone: 'bad', text: r.error }); return; }
		const already = Boolean((r.data as { results?: Array<{ already_installed?: boolean }> } | null)?.results?.[0]?.already_installed);
		set_msg({ tone: 'ok', text: already ? 'Already installed on this daemon.' : 'Install sent — the team appears once the daemon finishes.' });
		set_pick('');
		await reload();
	}
	async function uninstall(t: Host_team) {
		set_busy(true); set_msg(null);
		const r = await post('/v1/teams/uninstall', { daemon_id, scope: t.scope, slug: t.slug });
		set_busy(false); set_confirm(null);
		set_msg(r.ok ? { tone: 'ok', text: `Uninstall sent for ${team_label(t)}.` } : { tone: 'bad', text: r.error });
		if (r.ok) await reload();
	}
	const online = data.daemon.status === 'online';
	return (
		<section aria-label="Installed teams" className="flex flex-col gap-2">
			<h2 className="text-[14px] font-semibold">Installed teams</h2>
			{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
			{data.installed === null ? <p className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4 text-[12.5px] text-[var(--g-ink-3)]">{online ? 'The daemon didn’t answer the team list request.' : 'The daemon is offline, so its installed teams can’t be read right now.'}</p> : (
				<div className={TABLE_WRAP}>
					<table className="w-full text-[12.5px]">
						<thead><tr className="border-b border-[var(--g-line)]"><th className={TH}>Team</th><th className={TH}>Version</th><th className={TH} /></tr></thead>
						<tbody>
							{!data.installed.length ? <Empty_row cols={3}>No teams installed.</Empty_row> : null}
							{data.installed.map((t) => {
								const key = `${t.scope}/${t.slug}`;
								return (
									<tr key={key} className={TR} data-testid={`installed-${t.slug}`}>
										<td className="g-mono px-4 py-2.5"><Link to={`/teams/${encodeURIComponent(t.scope || '_')}/${encodeURIComponent(t.slug)}`} className="hover:underline">{team_label(t)}</Link></td>
										<td className="g-mono px-4 text-[var(--g-ink-2)]">{t.version ?? '—'}</td>
										<td className="px-4 text-right">{confirm === key
											? <span className="inline-flex gap-2"><button type="button" disabled={busy} onClick={() => void uninstall(t)} className={G_DANGER}>Uninstall</button><button type="button" onClick={() => set_confirm(null)} className={G_BTN}>Keep</button></span>
											: <button type="button" onClick={() => set_confirm(key)} className="text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">Uninstall…</button>}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
			{data.installable && data.installable.length ? (
				<div className="flex flex-wrap items-center gap-2" role="group" aria-label="Install a team">
					<select aria-label="Team to install" value={pick} onChange={(e) => set_pick(e.target.value)} className={`${G_INPUT} w-[280px]`}>
						<option value="">Install a realm team…</option>
						{data.installable.map((t) => <option key={t.team_id} value={t.team_id}>{team_label(t)}{t.version ? ` · ${t.version}` : ''}</option>)}
					</select>
					<button type="button" disabled={busy || !pick || !online} title={!online ? 'The daemon must be online' : undefined} onClick={() => void install()} className={G_PRIMARY}>Install</button>
				</div>
			) : null}
		</section>
	);
}

function Workspaces({ data, base, reload }: { data: Daemon_page_data; base: string; reload: () => Promise<void> }) {
	const [run_in, set_run_in] = useState<string | null>(null);
	const ws = data.workspaces;
	const installed = data.installed ?? [];
	return (
		<section aria-label="Workspaces" className="flex flex-col gap-2">
			<h2 className="text-[14px] font-semibold">Workspaces</h2>
			<div className={TABLE_WRAP}>
				<table className="w-full text-[12.5px]">
					<thead><tr className="border-b border-[var(--g-line)]"><th className={TH}>Workspace</th><th className={TH}>Teams</th><th className={TH}>Last run</th><th className={TH} /></tr></thead>
					<tbody>
						{ws === null ? <Empty_row cols={4}>Workspaces couldn’t be loaded.</Empty_row> : !ws.length ? <Empty_row cols={4}>No workspaces yet — one is created the first time a team runs in a folder.</Empty_row> : null}
						{(ws ?? []).map((w) => (
							<tr key={w.id} className={TR} data-testid={`workspace-${w.id}`}>
								<td className="max-w-[320px] px-4 py-2.5"><Link to={`${base}/workspaces/${encodeURIComponent(w.id)}`} className="block truncate font-semibold hover:underline">{w.name || w.path.split('/').pop() || w.id}</Link><span className="g-mono block truncate text-[11px] text-[var(--g-ink-3)]">{w.path}</span></td>
								<td className="g-mono max-w-[260px] truncate px-4 text-[var(--g-ink-2)]">{w.teams.length ? w.teams.join(', ') : '—'}</td>
								<td className="whitespace-nowrap px-4">{w.last_run_state ? <><Run_state state={w.last_run_state} /> <span className="text-[var(--g-ink-3)]">{w.last_run_at ? relative_time(w.last_run_at) : ''}</span></> : <span className="text-[var(--g-ink-3)]">—</span>}{w.active_runs ? <span className="g-mono ml-2 text-[11px] text-[var(--g-ink-3)]">{w.active_runs} live</span> : null}</td>
								<td className="px-4 text-right"><button type="button" onClick={() => set_run_in(run_in === w.id ? null : w.id)} className={G_BTN}>Run here</button></td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{run_in ? (() => {
				const w = (ws ?? []).find((x) => x.id === run_in)!;
				// Teams assembled in the workspace first; else whatever is installed on the daemon.
				const in_ws = installed.filter((t) => w.teams.includes(team_label(t)));
				return <Run_here teams={in_ws.length ? in_ws : installed} daemon_id={String(data.daemon.id ?? '')} workspace_id={w.id} workspace_path={w.path} base={base} on_done={reload} on_cancel={() => set_run_in(null)} />;
			})() : null}
		</section>
	);
}

export function Component() {
	const { org = '', slug = '', daemon_id = '' } = useParams();
	const overview = use_overview();
	const navigate = useNavigate();
	const post = use_post();
	const base = realm_path(org, slug);
	const read = use_bff_read<Daemon_page_data>('/v1/daemon_page/get', org && slug && daemon_id ? { org_slug: org, slug, daemon_id } : null, { refresh_ms: 15_000, fallback_error: 'Could not load the daemon.' });
	const d = read.data;
	const realm_id = d?.realm.id ?? null;
	const sidebar_realm = overview.data?.orgs.flatMap((o) => o.realms).find((r) => r.id === realm_id) ?? null;
	const [removing, set_removing] = useState(false);
	const [msg, set_msg] = useState<Msg>(null);
	const reload = async () => { await read.reload(); };
	async function remove() {
		const r = await post('/v1/daemons/remove', { daemon_id });
		if (!r.ok) { set_msg({ tone: 'bad', text: r.error }); set_removing(false); return; }
		navigate(`${base}/daemons`, { replace: true });
	}
	const dm = d?.daemon;
	return (
		<Graphite_shell
			data={overview.data}
			current_realm_id={realm_id}
			title="Daemon"
			actions={<button type="button" onClick={() => void read.reload()} aria-label="Refresh" title="Refresh" className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><RefreshCw className="h-3.5 w-3.5" /></button>}
		>
			<Realm_nav org_slug={org} slug={slug} realm={sidebar_realm} />
			<div className="flex flex-col gap-5 px-7 py-6">
				{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="daemon" /> : null}
				{!d && read.status !== 'error' ? <div className="h-[320px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading daemon" /> : null}
				{d && dm ? (
					<>
						<div className="text-[12.5px] text-[var(--g-ink-3)]"><Link to={`${base}/daemons`} className="hover:text-[var(--g-ink)]">Daemons</Link> / <span className="text-[var(--g-ink-2)]">{dm.name || dm.id}</span></div>
						<header className="flex flex-wrap items-center gap-3">
							<h1 className="text-[22px] font-semibold tracking-tight">{dm.name || dm.id}</h1>
							<Daemon_status status={dm.status} />
							<span className="ml-auto">{removing
								? <span className="inline-flex gap-2"><button type="button" onClick={() => void remove()} className={G_DANGER}>Remove daemon</button><button type="button" onClick={() => set_removing(false)} className={G_BTN}>Keep</button></span>
								: <button type="button" onClick={() => set_removing(true)} className="text-[12.5px] text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">Remove…</button>}</span>
						</header>
						{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
						{d.partial ? <p role="status" className="text-[12px] text-[var(--g-ink-3)]">Some details couldn’t be loaded.</p> : null}
						<div className="grid grid-cols-2 gap-4 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4 md:grid-cols-5">
							<Fact label="Host">{dm.hostname ?? '—'}</Fact>
							<Fact label="Last heartbeat">{dm.last_heartbeat ? relative_time(dm.last_heartbeat) : 'never'}</Fact>
							<Fact label="Capacity">{dm.capacity ?? '—'}</Fact>
							<Fact label="Owner">{dm.user_email ?? '—'}</Fact>
							<Fact label="Id"><span className="g-mono text-[12px]">{dm.id}</span></Fact>
						</div>
						<Teams data={d} reload={reload} />
						<Workspaces data={d} base={base} reload={reload} />
						<Host_runs runs={d.runs} total={d.runs_total} base={base} on_changed={reload} empty="No runs on this daemon yet." />
					</>
				) : null}
			</div>
		</Graphite_shell>
	);
}
