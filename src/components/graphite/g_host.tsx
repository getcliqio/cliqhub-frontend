/** Shared bits for Realm › Daemon and Realm › Workspace (Graphite). */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { relative_time } from '@/lib/overview';
import { Empty_row, Pill, TABLE_WRAP, TH, TR } from '@/components/graphite/g_admin';
import { G_BTN, G_INPUT, G_PRIMARY, use_post } from '@/components/graphite/g_agents';
import { ROW_OPENS, Row_open, use_row_open } from '@/components/graphite/g_row';

export interface Host_run { run_id: string; run_name: string | null; state: string; team: string | null; phase: string | null; started_at: number | null; completed_at: number | null; last_updated_at: number | null }
export interface Host_team { team_id: string | null; scope: string; slug: string; version: string | null }
export interface Host_workspace { id: string; name: string | null; path: string; teams: string[]; active_runs: number; last_run_state: string | null; last_run_at: number | null }
export interface Host_realm { id: string; slug: string; name: string; org_slug?: string | null }
export interface Daemon_page_data {
	realm: Host_realm;
	daemon: { id?: string; name?: string | null; hostname?: string | null; status?: string; last_heartbeat?: number | null; capacity?: number | null; version?: string | null; user_email?: string | null; created_at?: number | string | null; platform?: string | null; [k: string]: unknown };
	installed: Host_team[] | null;
	installable: Array<{ team_id: string; scope: string; slug: string; version: string | null }> | null;
	workspaces: Host_workspace[] | null;
	runs: Host_run[] | null;
	runs_total: number | null;
	partial: boolean;
}
export interface Workspace_page_data {
	realm: Host_realm;
	workspace: { id?: string; name?: string | null; path?: string; daemon_id?: string; daemon_hostname?: string | null; created_at?: number | string | null; [k: string]: unknown };
	teams: Host_team[];
	runs: Host_run[] | null;
	runs_total: number | null;
	partial: boolean;
}

export const G_DANGER = 'inline-flex items-center whitespace-nowrap rounded-md border border-[var(--g-bad-line)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-bad)] hover:bg-[var(--g-bad-soft)] disabled:opacity-40';
export const team_label = (t: { scope: string; slug: string }) => (t.scope ? `@${t.scope}/${t.slug}` : t.slug);

const DAEMON_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'muted' }> = { online: { label: 'Online', tone: 'ok' }, stale: { label: 'Stale', tone: 'warn' }, offline: { label: 'Offline', tone: 'muted' }, removed: { label: 'No longer connected', tone: 'muted' } };
export function Daemon_status({ status }: { status?: string }) {
	const s = DAEMON_STATUS[status ?? ''] ?? { label: status ?? 'unknown', tone: 'muted' as const };
	return <Pill tone={s.tone}>{s.label}</Pill>;
}
const RUN_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'run' | 'muted'> = { completed: 'ok', running: 'run', awaiting_input: 'warn', failed: 'bad', crashed: 'bad', cancelled: 'muted' };
export function Run_state({ state }: { state: string }) {
	return <Pill tone={RUN_TONE[state] ?? 'muted'}>{state.replace('_', ' ')}</Pill>;
}

/** The run id of Core's `runs/enqueue` data (`{ run_id, daemon_id, accepted }`). */
export function run_id_of(d: unknown): string | null {
	const v = ((d ?? {}) as { run_id?: unknown }).run_id;
	return typeof v === 'string' ? v : null;
}

export function parse_inputs(text: string): { ok: true; inputs: Record<string, string> } | { ok: false; line: number } {
	const inputs: Record<string, string> = {};
	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i].trim();
		if (!l) continue;
		const at = l.indexOf('=');
		if (at < 1) return { ok: false, line: i + 1 };
		inputs[l.slice(0, at).trim()] = l.slice(at + 1).trim();
	}
	return { ok: true, inputs };
}

/** Runs table with cancel (confirm) for live runs; awaiting input opens the run page. */
export function Host_runs({ runs, total, base, on_changed, empty }: { runs: Host_run[] | null; total: number | null; base: string; on_changed: () => Promise<void> | void; empty: string }) {
	const row = use_row_open();
	const post = use_post();
	const [confirm, set_confirm] = useState<string | null>(null);
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const [busy, set_busy] = useState(false);
	async function cancel(id: string) {
		set_busy(true); set_msg(null);
		const r = await post('/v1/runs/cancel', { run_id: id });
		set_busy(false); set_confirm(null);
		set_msg(r.ok ? { tone: 'ok', text: 'Cancel sent.' } : { tone: 'bad', text: r.error });
		if (r.ok) await on_changed();
	}
	return (
		<section aria-label="Runs" className="flex flex-col gap-2">
			<div className="flex items-baseline gap-2"><h2 className="text-[14px] font-semibold">Recent runs</h2>{total !== null ? <span className="g-mono text-[11.5px] text-[var(--g-ink-3)]">{runs && total > runs.length ? `${runs.length} of ${total}` : total}</span> : null}</div>
			{msg ? <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`text-[12.5px] ${msg.tone === 'bad' ? 'text-[var(--g-bad)]' : 'text-[var(--g-ok)]'}`}>{msg.text}</p> : null}
			<div className={TABLE_WRAP}>
				<table className="w-full text-[12.5px]">
					<thead><tr className="border-b border-[var(--g-line)]"><th className={TH}>Run</th><th className={TH}>Team</th><th className={TH}>State</th><th className={TH}>Updated</th><th className={TH} /></tr></thead>
					<tbody>
						{runs === null ? <Empty_row cols={5}>Runs couldn’t be loaded.</Empty_row> : !runs.length ? <Empty_row cols={5}>{empty}</Empty_row> : null}
						{(runs ?? []).map((r) => {
							const live = r.state === 'running' || r.state === 'awaiting_input';
							const at = r.last_updated_at ?? r.completed_at ?? r.started_at;
							return (
								<tr key={r.run_id} {...row({ to: `${base}/runs/${encodeURIComponent(r.run_id)}` })} className={`${TR} ${ROW_OPENS}`} data-testid={`run-${r.run_id}`}>
									<td className="max-w-[260px] px-4 py-2.5"><Link to={`${base}/runs/${encodeURIComponent(r.run_id)}`} className="block truncate font-semibold hover:underline">{r.run_name || r.run_id}</Link>{r.phase ? <span className="text-[11.5px] text-[var(--g-ink-3)]">{r.phase}</span> : null}</td>
									<td className="g-mono max-w-[220px] truncate px-4 text-[var(--g-ink-2)]">{r.team ?? '—'}</td>
									<td className="px-4"><Run_state state={r.state} /></td>
									<td className="whitespace-nowrap px-4 text-[var(--g-ink-3)]">{at ? relative_time(at) : '—'}</td>
									<td className="px-4 text-right">
										{r.state === 'awaiting_input' ? <Link to={`${base}/runs/${encodeURIComponent(r.run_id)}`} className={`${G_BTN} mr-2`}>Provide input</Link> : live ? <span className="mr-2 inline-block"><Row_open to={`${base}/runs/${encodeURIComponent(r.run_id)}`} label={`Open ${r.run_name || r.run_id}`} /></span> : null}
										{live ? (confirm === r.run_id
											? <span className="inline-flex gap-2"><button type="button" disabled={busy} onClick={() => void cancel(r.run_id)} className={G_DANGER}>Cancel run</button><button type="button" onClick={() => set_confirm(null)} className={G_BTN}>Keep</button></span>
											: <button type="button" onClick={() => set_confirm(r.run_id)} className="text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">Cancel…</button>) : null}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</section>
	);
}

/** Start a run of an installed team in one workspace (runs/enqueue with daemon + workspace). */
export function Run_here({ teams, daemon_id, workspace_id, workspace_path, base, on_done, on_cancel }: { teams: Host_team[]; daemon_id: string; workspace_id: string; workspace_path: string; base: string; on_done: () => Promise<void> | void; on_cancel: () => void }) {
	const post = use_post();
	const runnable = teams.filter((t) => t.team_id);
	const [team_id, set_team_id] = useState(runnable[0]?.team_id ?? '');
	const [name, set_name] = useState('');
	const [text, set_text] = useState('');
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string; run_id?: string | null } | null>(null);
	const [busy, set_busy] = useState(false);
	async function submit(e: FormEvent) {
		e.preventDefault();
		const parsed = parse_inputs(text);
		if (!parsed.ok) { set_msg({ tone: 'bad', text: `Line ${parsed.line}: use name=value.` }); return; }
		set_busy(true); set_msg(null);
		const r = await post('/v1/runs/enqueue', { daemon_id, workspace_id, workspace_path, team_id, ...(name.trim() ? { run_name: name.trim() } : {}), ...(Object.keys(parsed.inputs).length ? { inputs: parsed.inputs } : {}) });
		set_busy(false);
		if (!r.ok) { set_msg({ tone: 'bad', text: r.error }); return; }
		set_msg({ tone: 'ok', text: 'Run queued.', run_id: run_id_of(r.data) });
		set_name(''); set_text('');
		await on_done();
	}
	if (!runnable.length) return <p className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4 text-[12.5px] text-[var(--g-ink-3)]">No teams are set up in this workspace yet. Install a team on the daemon first.</p>;
	return (
		<form onSubmit={(e) => void submit(e)} aria-label="Run a team here" className="flex flex-col gap-3 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4">
			<div className="flex flex-wrap items-end gap-3">
				<label className="text-[12.5px] text-[var(--g-ink-2)]">Team<select aria-label="Team" value={team_id} onChange={(e) => set_team_id(e.target.value)} className={`${G_INPUT} mt-1 block w-[260px]`}>{runnable.map((t) => <option key={t.team_id!} value={t.team_id!}>{team_label(t)}{t.version ? ` · ${t.version}` : ''}</option>)}</select></label>
				<label className="text-[12.5px] text-[var(--g-ink-2)]">Run name <span className="text-[var(--g-ink-3)]">(optional)</span><input aria-label="Run name" value={name} onChange={(e) => set_name(e.target.value)} placeholder="PROJ-482" className={`${G_INPUT} mt-1 block w-[200px]`} /></label>
			</div>
			<label className="text-[12.5px] text-[var(--g-ink-2)]">Inputs <span className="text-[var(--g-ink-3)]">(one name=value per line; the team asks for anything missing)</span><textarea aria-label="Inputs" value={text} onChange={(e) => set_text(e.target.value)} rows={3} className={`${G_INPUT} g-mono mt-1 block h-auto w-full py-2`} /></label>
			{msg ? <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`text-[12.5px] ${msg.tone === 'bad' ? 'text-[var(--g-bad)]' : 'text-[var(--g-ok)]'}`}>{msg.text}{msg.run_id ? <> <Link to={`${base}/runs/${encodeURIComponent(msg.run_id)}`} className="text-[var(--g-acc)] hover:underline">Open run →</Link></> : null}</p> : null}
			<div className="flex gap-2"><button type="submit" disabled={busy || !team_id} className={G_PRIMARY}>Start run</button><button type="button" onClick={on_cancel} className={G_BTN}>Close</button></div>
		</form>
	);
}
