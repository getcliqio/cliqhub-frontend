/**
 * Realm › Workspace (Graphite) — /o/:org/realms/:slug/workspaces/:workspace_id
 * Read: one `POST /v1/workspace_page/get` (BFF: realm gate, workspaces/get_by_id, runs).
 * Writes (Core): runs/enqueue · runs/cancel.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { use_overview, relative_time } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { realm_path } from '@/lib/realm_url';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Realm_nav } from '@/components/graphite/realm_nav';
import { G_PRIMARY } from '@/components/graphite/g_agents';
import { Host_runs, Run_here, team_label, type Workspace_page_data } from '@/components/graphite/g_host';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

export function Component() {
	const { org = '', slug = '', workspace_id = '' } = useParams();
	const overview = use_overview();
	const base = realm_path(org, slug);
	const read = use_bff_read<Workspace_page_data>('/v1/workspace_page/get', org && slug && workspace_id ? { org_slug: org, slug, workspace_id } : null, { refresh_ms: 10_000, fallback_error: 'Could not load the workspace.' });
	const d = read.data;
	const realm_id = d?.realm.id ?? null;
	const sidebar_realm = overview.data?.orgs.flatMap((o) => o.realms).find((r) => r.id === realm_id) ?? null;
	const [running, set_running] = useState(false);
	const reload = async () => { await read.reload(); };
	const w = d?.workspace;
	const created = w?.created_at ? (typeof w.created_at === 'number' ? w.created_at : Date.parse(String(w.created_at))) : null;
	return (
		<Graphite_shell
			data={overview.data}
			current_realm_id={realm_id}
			title="Workspace"
			actions={<button type="button" onClick={() => void read.reload()} aria-label="Refresh" title="Refresh" className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><RefreshCw className="h-3.5 w-3.5" /></button>}
		>
			<Realm_nav org_slug={org} slug={slug} realm={sidebar_realm} />
			<div className="flex flex-col gap-5 px-7 py-6">
				{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="workspace" /> : null}
				{!d && read.status !== 'error' ? <div className="h-[300px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading workspace" /> : null}
				{d && w ? (
					<>
						<div className="text-[12.5px] text-[var(--g-ink-3)]"><Link to={`${base}/daemons`} className="hover:text-[var(--g-ink)]">Daemons</Link>{w.daemon_id ? <> / <Link to={`${base}/daemons/${encodeURIComponent(w.daemon_id)}`} className="hover:text-[var(--g-ink)]">{w.daemon_hostname || w.daemon_id}</Link></> : null} / <span className="text-[var(--g-ink-2)]">{w.name || w.path}</span></div>
						<header className="flex flex-wrap items-center gap-3">
							<div className="min-w-0"><h1 className="truncate text-[22px] font-semibold tracking-tight">{w.name || (w.path ?? '').split('/').pop() || w.id}</h1><p className="g-mono truncate text-[12px] text-[var(--g-ink-3)]">{w.path}{created ? ` · since ${relative_time(created)}` : ''}</p></div>
							{w.daemon_id ? <button type="button" onClick={() => set_running((v) => !v)} className={`${G_PRIMARY} ml-auto`}>Run a team here</button> : null}
						</header>
						{running && w.daemon_id ? <Run_here teams={d.teams} daemon_id={w.daemon_id} workspace_id={String(w.id ?? workspace_id)} workspace_path={w.path ?? ''} base={base} on_done={reload} on_cancel={() => set_running(false)} /> : null}
						<section aria-label="Teams" className="flex flex-col gap-2">
							<h2 className="text-[14px] font-semibold">Teams set up here</h2>
							{d.teams.length ? <div className="flex flex-wrap gap-2">{d.teams.map((t) => <Link key={`${t.scope}/${t.slug}`} to={`/teams/${encodeURIComponent(t.scope || '_')}/${encodeURIComponent(t.slug)}`} className="g-mono rounded-full border border-[var(--g-line)] bg-[var(--g-panel)] px-3 py-1 text-[12px] hover:border-[var(--g-acc-line)]">{team_label(t)}</Link>)}</div> : <p className="text-[12.5px] text-[var(--g-ink-3)]">None yet — a team is assembled here the first time it runs.</p>}
						</section>
						<Host_runs runs={d.runs} total={d.runs_total} base={base} on_changed={reload} empty="No runs in this workspace yet." />
					</>
				) : null}
			</div>
		</Graphite_shell>
	);
}
