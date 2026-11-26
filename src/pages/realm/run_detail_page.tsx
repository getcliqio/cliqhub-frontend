/**
 * Run detail (Graphite) — under the realm header:
 *   run line  — name, state, team · version · started · took · cost · tokens, View workflow; one set of actions
 *   failure   — why it failed (no second Resume / Logs: the header and the Logs view have them)
 *   left      — the phases, as a List (each row: what happened, its time on the run's clock — rounds as
 *               segments, waits on people hatched, long waits folded — and cost; sub-teams nest inside
 *               their phase) or as the team's Workflow graph; Usage and Logs are the other views
 *   right     — the selected phase (failed / running one first): its output and its artifacts;
 *               Run details (inputs, workspace, daemon, IDs) folded below
 *
 * Data: one `POST /v1/run_detail/get { run_id }` per poll (BFF composes the run row, phases, labels,
 * realm, this run's open Hugs and its stored artifacts). Polls every 4s while the run is live,
 * 20s otherwise. Telemetry (cost, tokens, the clock, Usage, Workflow): one `POST /v1/run_telemetry/get`.
 * Control actions stay on the existing Core routes: /v1/runs/cancel · /v1/runs/resume. A run awaiting
 * input waits on a Hug: the banner links to it. "Run again" reuses Run_in_realm_dialog (prefilled from this run). Old links:
 * ?tab=timeline opens the List, ?tab=dag the Workflow.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { hug_href } from '@/lib/hug';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { use_overview, relative_time } from '@/lib/overview';
import { api_code, api_message, use_bff_read } from '@/lib/use_bff_read';
import {
	format_duration,
	is_live_state,
	run_href,
	type Force_terminate_status,
	type Pending_control,
	type Run_attempt,
	type Run_child,
	type Run_detail_data,
	type Run_parent,
	type Run_artifact,
	type Run_detail_phase,
	type Run_phase_output,
	type Run_row,
	type Run_hug_round,
} from '@/lib/realm_inbox';
import { realm_path } from '@/lib/realm_url';
import { format_datetime } from '@/lib/format_time';
import { pick_default_resume_phase } from '@/components/dispatch/run_dialogs';
import { Run_in_realm_dialog } from '@/components/run_in_realm_dialog';
import { sort_phases_workflow } from '@/components/runs/run_phases_panel';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { use_access, type Gate } from '@/lib/access';
import { Realm_nav } from '@/components/graphite/realm_nav';
import { State_dot, State_pill } from '@/components/graphite/g_status';
import { Origin_badge } from '@/components/graphite/g_origin_badge';
import { G_run_logs } from '@/components/graphite/g_run_logs';
import { Run_failure_card } from '@/components/graphite/g_run_failure';
import { Step_details, all_sub_runs, initially_open, type Tree_step } from '@/components/graphite/g_sub_team_tree';
import { Timeline, Usage } from '@/components/graphite/g_telemetry';
import { Workflow_graph } from '@/components/graphite/g_workflow_graph';
import type { Team_phase } from '@/lib/team_page';
import { fmt_count, fmt_usd, type Run_telemetry_data } from '@/lib/run_telemetry';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';
import { person_name } from '@/components/graphite/g_person';
import { Phase_panel, Run_story, type Inspect, type Story_props } from '@/components/graphite/g_run_story';

export const LIVE_POLL_MS = 4_000;
export const IDLE_POLL_MS = 20_000;

/** Codes for which the only path forward is "Run again". */
const STRANDED_CODES = new Set(['run/stranded', 'run/daemon_stranded']);

/**
 * Views of the run (PLAN-run-page S2): the run itself, phase by phase (default); the team's graph;
 * usage; logs; run details.
 */
type Tab = 'phases' | 'graph' | 'timeline' | 'usage' | 'logs' | 'details';
const TABS: Tab[] = ['phases', 'graph', 'timeline', 'usage', 'logs', 'details'];
const TAB_LABEL: Record<Tab, string> = { phases: 'Run', graph: 'Graph', timeline: 'Timeline', usage: 'Usage', logs: 'Logs', details: 'Details' };
/** Old view links: the DAG / workflow is the Graph view. */
const OLD_TAB: Record<string, Tab> = { dag: 'graph', workflow: 'graph' };
type Panel = null | 'cancel' | 'resume';

/** `scope/slug` team id → parts for "Run again"; null hides the action. */
/** A run's title: a sub-team run reads as its team ("design-lld"); otherwise its name. */
export function run_title(run: Run_row, is_sub_team: boolean): string {
	const team = is_sub_team ? (run.team_label ?? '').replace(/^@[^/]+\//, '') : '';
	return team || run.run_name || run.run_id;
}

export function parse_team_id(team_id: string | null | undefined): { scope: string; slug: string } | null {
	const parts = (team_id ?? '').trim().split('/');
	if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
	return { scope: parts[0], slug: parts[1] };
}

function parse_inputs(raw: Run_row['inputs']): Record<string, unknown> | null {
	if (!raw) return null;
	if (typeof raw === 'string') {
		try {
			const v = JSON.parse(raw);
			return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
		} catch {
			return null;
		}
	}
	return typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

function control_label(endpoint: string): string {
	if (endpoint === '/v1/cancel') return 'Cancel';
	if (endpoint === '/v1/resume') return 'Resume';
	if (endpoint === '/v1/execute') return 'Start';
	return endpoint;
}

/* ------------------------------------------------------------------ */
/* Banners                                                             */

function Banner({ tone, role = 'status', testid, title, children, action }: {
	tone: 'warn' | 'bad' | 'muted' | 'ok';
	role?: 'status' | 'alert';
	testid?: string;
	title: React.ReactNode;
	children?: React.ReactNode;
	action?: React.ReactNode;
}) {
	const cls = tone === 'bad'
		? 'border-[var(--g-bad-line)] bg-[var(--g-bad-soft)]'
		: tone === 'warn'
			? 'border-[rgba(255,178,36,.35)] bg-[var(--g-warn-soft)]'
			: tone === 'ok'
				? 'border-[rgba(62,207,142,.35)] bg-[var(--g-ok-soft)]'
				: 'border-[var(--g-line)] bg-[var(--g-soft)]';
	return (
		<div role={role} data-testid={testid} className={`flex flex-wrap items-start gap-3 rounded-[10px] border px-4 py-3 text-[13px] ${cls}`}>
			<div className="min-w-0 flex-1">
				<p className="font-semibold">{title}</p>
				{children ? <div className="mt-0.5 text-[12px] text-[var(--g-ink-2)]">{children}</div> : null}
			</div>
			{action}
		</div>
	);
}

function Pending_banner({ pending, daemon_id }: { pending: Pending_control; daemon_id: string | null }) {
	const status = pending.delivered_at === null ? 'queued — waiting for the Hub worker to pick it up' : 'delivered — waiting for the daemon to acknowledge';
	const attempts = pending.attempts > 0 ? `${pending.attempts}/${pending.max_attempts} delivery attempt${pending.attempts === 1 ? '' : 's'}` : 'no delivery attempts yet';
	return (
		<Banner tone="warn" testid="pending-control-banner" title={<>{control_label(pending.endpoint)} pending on daemon{daemon_id ? <span className="g-mono"> {daemon_id}</span> : null}</>}>
			<p>{status} · {attempts} · queued {relative_time(pending.enqueued_at)}</p>
			{pending.last_error ? <p className="mt-1">Last error: <span className="g-mono">{pending.last_error}</span></p> : null}
			{pending.attempts >= 3 && pending.delivered_at === null ? (
				<p className="mt-1">The daemon isn’t answering. Click Cancel again — the Hub will mark the run cancelled if the daemon stays unreachable.</p>
			) : null}
		</Banner>
	);
}

function Force_banner({ status }: { status: Force_terminate_status }) {
	return (
		<Banner
			tone="muted"
			testid="force-terminated-banner"
			title={<>Cancelled on the Hub{status.terminated_by_user_id ? ` by user ${status.terminated_by_user_id}` : ''}{status.terminated_at ? ` · ${relative_time(status.terminated_at)}` : ''}</>}
		>
			<p>This run was marked cancelled at the Hub because the daemon was unresponsive. The daemon may still have been working when the mark was applied — restart cliqd to be certain the process stopped.</p>
			{status.terminated_reason ? <p className="mt-1">Reason: {status.terminated_reason}</p> : null}
		</Banner>
	);
}

/* ------------------------------------------------------------------ */
/* Attempts                                                            */

function attempt_outcome(a: Run_attempt): string {
	const at = a.failed_phase ? ` at ${a.failed_phase}` : '';
	if (a.state === 'completed') return 'completed';
	if (a.state === 'failed') return `failed${at}`;
	if (a.state === 'crashed') return `crashed${at}`;
	if (a.state === 'cancelled') return `cancelled${at}`;
	if (a.state === 'running') return 'running';
	return 'ended';
}

/**
 * The run's history when it was resumed: "Attempt 1 · failed at design ·
 * 20h ago → Resumed from design · 19h ago → Attempt 2 · completed".
 * Nothing for a run with a single attempt.
 */
export function Attempts_strip({ attempts, source }: { attempts: Run_attempt[] | null | undefined; source?: 'events' | 'phases' | null }) {
	if (!attempts || attempts.length < 2) return null;
	return (
		<section
			aria-label="Attempts"
			data-testid="attempts-strip"
			className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-2.5 text-[12.5px]"
		>
			<span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">{attempts.length} attempts</span>
			{attempts.map((a) => (
				<span key={a.n} className="contents">
					{a.n > 1 ? (
						<>
							<span aria-hidden className="text-[var(--g-ink-4)]">→</span>
							<span className="text-[var(--g-ink-2)]" data-testid="attempt-resume">
								Resumed{a.from_phase ? <> from <span className="g-mono">{a.from_phase}</span></> : null}
								{a.resumed_by ? <> by <b className="font-semibold text-[var(--g-ink)]">{a.resumed_by.display_name || a.resumed_by.username}</b></> : null}
								{a.started_at ? <span className="text-[var(--g-ink-3)]" title={format_datetime(a.started_at)}> · {relative_time(a.started_at)}</span> : null}
							</span>
							<span aria-hidden className="text-[var(--g-ink-4)]">→</span>
						</>
					) : null}
					<span className="inline-flex items-center gap-1.5" data-testid="attempt" title={a.error ?? undefined}>
						<State_dot state={a.state === 'unknown' ? 'pending' : a.state} pulse={a.state === 'running'} />
						<span className="font-semibold">Attempt {a.n}</span>{' '}
						<span className={a.state === 'completed' ? 'text-[var(--g-ink-2)]' : a.state === 'running' ? 'text-[var(--g-run-text)]' : a.state === 'unknown' ? 'text-[var(--g-ink-3)]' : 'text-[var(--g-bad-text)]'}>
							· {attempt_outcome(a)}
						</span>{' '}
						{a.ended_at && a.state !== 'running' ? <span className="text-[var(--g-ink-3)]" title={format_datetime(a.ended_at)}>· {relative_time(a.ended_at)}</span> : null}
					</span>
				</span>
			))}
			{source === 'phases' ? (
				<span className="ml-auto text-[11.5px] text-[var(--g-ink-3)]" title="No run events are visible to you for this run, so the attempts were worked out from each phase's history.">from phase history</span>
			) : null}
		</section>
	);
}

/** Link to another run: its own realm when known, else this run's. */
function other_run_href(r: { run_id: string; org_slug: string | null; realm_slug: string | null }, org_slug: string, slug: string): string {
	return run_href(r.org_slug ?? org_slug, r.realm_slug ?? slug, r.run_id);
}

/* ------------------------------------------------------------------ */
/* Details sidebar                                                     */

function Copy_value({ value, label }: { value: string; label: string }) {
	const [done, set_done] = useState(false);
	return (
		<span className="flex min-w-0 items-center gap-1.5">
			<code className="g-mono min-w-0 select-all truncate text-[12px] text-[var(--g-ink-2)]" title={value}>{value}</code>
			<button
				type="button"
				aria-label={`Copy ${label}`}
				title={done ? 'Copied' : `Copy ${label}`}
				onClick={async () => {
					try {
						await navigator.clipboard.writeText(value);
						set_done(true);
						setTimeout(() => set_done(false), 1200);
					} catch { /* ignore */ }
				}}
				className="shrink-0 text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"
			>
				{done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
			</button>
		</span>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="min-w-0">
			<dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">{label}</dt>
			<dd className="mt-1 min-w-0 text-[12.5px]">{children}</dd>
		</div>
	);
}

/** The team page's YAML tab at the version this run used (team_label is `@scope/name`). */
/** The team page's workflow at the version this run used (team_label is `@scope/name`). */
export function workflow_href(run: { team_label?: string | null; team_version?: string | null }): string | null {
	const m = /^@([^/]+)\/(.+)$/.exec(run.team_label ?? '');
	if (!m) return null;
	return `/teams/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}${run.team_version ? `?v=${encodeURIComponent(run.team_version)}` : ''}`;
}

export function team_yaml_href(run: { team_label?: string | null; team_version?: string | null }): string | null {
	const m = /^@([^/]+)\/(.+)$/.exec(run.team_label ?? '');
	if (!m) return null;
	const q = new URLSearchParams({ tab: 'files', file: 'team.yml' });
	if (run.team_version) q.set('v', run.team_version);
	return `/teams/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}?${q.toString()}`;
}

/** Run details (folded under the phase panel): what the run line above doesn't already say. */
function Details({ run, base, parent, run_link }: {
	run: Run_row;
	base: string;
	parent?: Run_parent | null;
	run_link: (r: { run_id: string; org_slug: string | null; realm_slug: string | null }) => string;
}) {
	const inputs = parse_inputs(run.inputs);
	const labels = Object.entries(run.context_labels ?? {}).filter(([k]) => k !== 'external_url');
	return (
		<aside className="flex flex-col gap-3.5" aria-label="Run details">
			<section className="px-1">
				<dl className="grid gap-3.5">
					{parent ? (
						<Field label="Spawned by">
							<span className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="parent-run">
								{parent.state ? <State_dot state={parent.state} /> : null}
								<Link to={run_link(parent)} className="min-w-0 truncate font-semibold hover:underline">{parent.run_name || parent.run_id}</Link>
								{parent.phase ? <><span aria-hidden className="text-[var(--g-ink-4)]">›</span><span className="g-mono text-[12px] text-[var(--g-ink-2)]">{parent.phase}</span></> : null}
							</span>
						</Field>
					) : null}
					<Field label="Run ID"><Copy_value value={run.run_id} label="run id" /></Field>
					<Field label="Workspace">
						{run.workspace_id ? (
							<Link to={`${base}/workspaces/${encodeURIComponent(run.workspace_id)}`} className="hover:underline">{run.workspace_name || run.workspace_id}</Link>
						) : '—'}
					</Field>
					<Field label="Daemon">
						{run.daemon_id ? (
							<span className="flex items-center gap-2">
								<Link to={`${base}/daemons/${encodeURIComponent(run.daemon_id)}`} className="g-mono truncate text-[12px] hover:underline">{run.daemon_id}</Link>
							</span>
						) : run.started_at ? (
							// It ran, but its daemon's record was removed (before 2026-10-07 removing a daemon erased it from its runs).
							<span className="text-[var(--g-ink-3)]" title="This run did run on a daemon, but that daemon is no longer registered with CliqHub, so its name isn't known.">daemon no longer registered</span>
						) : <span className="text-[var(--g-warn-text)]">no daemon assigned</span>}
					</Field>
					{run.external_id ? (
						<Field label="External">
							{run.context_labels?.external_url ? (
								<a href={run.context_labels.external_url} target="_blank" rel="noreferrer" className="g-mono text-[12px] hover:underline">{run.external_id}</a>
							) : <Copy_value value={run.external_id} label="external id" />}
						</Field>
					) : null}
				</dl>
			</section>
			{inputs || labels.length ? (
				<section className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4">
					<h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">{inputs ? 'Inputs & labels' : 'Labels'}</h3>
					<dl className="g-mono mt-2 grid gap-1.5 text-[12px]">
						{labels.map(([k, v]) => (
							<div key={`l-${k}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2"><dt className="truncate text-[var(--g-ink-3)]" title={k}>{k}</dt><dd className="truncate" title={String(v)}>{String(v)}</dd></div>
						))}
						{inputs ? Object.entries(inputs).map(([k, v]) => (
							<div key={`i-${k}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2"><dt className="truncate text-[var(--g-ink-3)]" title={k}>{k}</dt><dd className="truncate" title={typeof v === 'string' ? v : JSON.stringify(v)}>{typeof v === 'string' ? v : JSON.stringify(v)}</dd></div>
						)) : null}
					</dl>
				</section>
			) : null}
		</aside>
	);
}

/* ------------------------------------------------------------------ */
/* Action panels                                                       */

function Cancel_panel({ busy, on_confirm, on_cancel }: { busy: boolean; on_confirm: () => void; on_cancel: () => void }) {
	return (
		<section className="rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-panel)] p-4" aria-label="Cancel run" data-testid="cancel-panel">
			<p className="text-[13px] font-semibold">Cancel this run?</p>
			<p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">The daemon stops the current phase. If the daemon is unreachable the Hub marks the run cancelled.</p>
			<div className="mt-3 flex gap-2">
				<button type="button" disabled={busy} onClick={on_confirm} className="rounded-md bg-[var(--g-bad)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-color)] disabled:opacity-50">
					{busy ? 'Cancelling…' : 'Confirm cancel'}
				</button>
				<button type="button" onClick={on_cancel} className="rounded-md border border-[var(--g-line)] px-3 py-1.5 text-[12.5px]">Keep running</button>
			</div>
		</section>
	);
}

function Resume_panel({ phases, busy, on_submit, on_cancel, initial }: { phases: Run_detail_phase[]; busy: boolean; on_submit: (phase: string) => void; on_cancel: () => void; initial?: string | null }) {
	const [phase, set_phase] = useState(() => initial || pick_default_resume_phase(phases));
	useEffect(() => set_phase(initial || pick_default_resume_phase(phases)), [phases, initial]);
	return (
		<section className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4" aria-label="Resume from phase" data-testid="resume-panel">
			<p className="text-[13px] font-semibold">Resume from a phase</p>
			{phases.length === 0 ? (
				<p className="mt-1 text-[12px] text-[var(--g-ink-3)]">No phases recorded yet — there is no resume point.</p>
			) : (
				<label className="mt-2 block text-[12px] text-[var(--g-ink-3)]">
					Start from
					<select
						value={phase}
						onChange={(e) => set_phase(e.target.value)}
						className="g-mono mt-1 block w-full rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 py-1.5 text-[12.5px] text-[var(--g-ink)]"
						data-testid="resume-select"
					>
						{phases.map((p) => <option key={p.phase} value={p.phase}>{p.phase} — {p.status}</option>)}
					</select>
				</label>
			)}
			<div className="mt-3 flex gap-2">
				<button type="button" disabled={!phase || busy} onClick={() => on_submit(phase)} className="rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-acc)] disabled:opacity-50">
					{busy ? 'Resuming…' : `Resume from ${phase || '…'}`}
				</button>
				<button type="button" onClick={on_cancel} className="rounded-md border border-[var(--g-line)] px-3 py-1.5 text-[12.5px]">Close</button>
			</div>
		</section>
	);
}

/* ------------------------------------------------------------------ */

const BTN = 'inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--g-line)] px-3 text-[12.5px] font-semibold hover:bg-[var(--g-soft)]';
const BTN_PRIMARY = 'inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--g-acc)] px-3 text-[12.5px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)]';
const BTN_WAIT = 'inline-flex h-8 cursor-not-allowed items-center rounded-md border border-[var(--g-line)] px-3 text-[12.5px] font-semibold text-[var(--g-ink-3)]';

/** What the viewer may do on this run (from `lib/access.ts`); everything allowed when not given. */
export interface Run_gates { cancel: Gate; run: Gate }
const ALL_ALLOWED: Run_gates = { cancel: { ok: true, reason: null }, run: { ok: true, reason: null } };

export function Run_view({ data, org_slug, slug, reload, gates = ALL_ALLOWED, realm_org_id = null }: { data: Run_detail_data; org_slug: string; slug: string; reload: () => Promise<void>; gates?: Run_gates; /** The realm's org id ("Run again" searches its channels and people). */ realm_org_id?: string | null }) {
	const auth_fetch = useAuthFetch();
	const { run } = data;
	const base = realm_path(org_slug, slug);
	const [search, set_search] = useSearchParams();
	const tab: Tab = ((v) => (TABS.includes(v as Tab) ? v as Tab : OLD_TAB[v ?? ''] ?? 'phases'))(search.get('tab'));
	const set_tab = useCallback((t: Tab) => {
		set_search((prev) => {
			const p = new URLSearchParams(prev);
			if (t === 'phases') p.delete('tab');
			else p.set('tab', t);
			return p;
		}, { replace: true });
	}, [set_search]);

	const [panel, set_panel] = useState<Panel>(null);
	const [resume_initial, set_resume_initial] = useState<string | null>(null);
	const [busy, set_busy] = useState<null | 'cancel' | 'resume'>(null);
	const [notice, set_notice] = useState<string | null>(null);
	const [error, set_error] = useState<{ message: string; code: string | null } | null>(null);
	const [run_again, set_run_again] = useState(false);
	const telemetry_read = use_bff_read<Run_telemetry_data>('/v1/run_telemetry/get', { run_id: run.run_id }, { refresh_ms: is_live_state(run.state) ? 8_000 : 0, fallback_error: 'Could not load telemetry.' });
	const telemetry = telemetry_read.data;
	// The phase whose output and artifacts show on the right (null: follow the run — running, waiting or failed phase).
	const [phase_pick, set_phase_pick] = useState<string | null>(null);
	const [log_q, set_log_q] = useState<string | null>(null);
	// Phases tab: the sub-team tree (open runs, selected step). Failed / live sub-teams start open.
	const [step, set_step] = useState<Tree_step | null>(null);
	const [tree_open, set_tree_open] = useState<Set<string> | null>(null);
	const sub_runs_all = useMemo(() => (telemetry?.phases ?? []).flatMap((p) => p.sub_runs ?? []), [telemetry]);
	// Until the viewer folds or opens something, the open set follows the data (failed / live open).
	const tree_open_now = useMemo(() => tree_open ?? initially_open(sub_runs_all), [tree_open, sub_runs_all]);
	const toggle_tree = (id: string) => set_tree_open(() => { const n = new Set(tree_open_now); if (n.has(id)) n.delete(id); else n.add(id); return n; });
	// `?resume=<phase>` (from a parent run's "Why it failed"): open the resume panel set to it, once.
	useEffect(() => {
		const phase = search.get('resume');
		if (!phase) return;
		set_resume_initial(phase);
		set_panel('resume');
		set_search((prev) => { const p = new URLSearchParams(prev); p.delete('resume'); return p; }, { replace: true });
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const phases = useMemo(() => sort_phases_workflow(data.phases.map((p) => ({ ...p, agent_name: p.agent })) as unknown as Parameters<typeof sort_phases_workflow>[0]) as unknown as Run_detail_phase[], [data.phases]);
	const phase_outputs = useMemo(() => data.phase_outputs ?? [], [data.phase_outputs]);
	const outputs_by_phase = useMemo(() => {
		const m = new Map<string, Run_phase_output[]>();
		for (const o of phase_outputs) m.set(o.phase, [...(m.get(o.phase) ?? []), o]);
		return m;
	}, [phase_outputs]);
	const handoffs_by_phase = useMemo(() => {
		const m = new Map<string, Run_artifact[]>();
		for (const a of data.artifacts ?? []) if (a.source === 'record' && a.kind === 'handoff') m.set(a.phase, [...(m.get(a.phase) ?? []), a]);
		return m;
	}, [data.artifacts]);
	const children = useMemo(() => data.children ?? [], [data.children]);
	const children_by_phase = useMemo(() => {
		const m = new Map<string, Run_child[]>();
		for (const c of children) if (c.parent_phase) m.set(c.parent_phase, [...(m.get(c.parent_phase) ?? []), c]);
		return m;
	}, [children]);
	const other_run_link = useCallback((r: { run_id: string; org_slug: string | null; realm_slug: string | null }) => other_run_href(r, org_slug, slug), [org_slug, slug]);
	const live = is_live_state(run.state);
	const rounds_by_phase = useMemo(() => {
		const m = new Map<string, Run_hug_round[]>();
		for (const r of data.hug_rounds ?? []) if (r.phase) m.set(r.phase, [...(m.get(r.phase) ?? []), r]);
		return m;
	}, [data.hug_rounds]);
	const phase_sel = phase_pick ?? (phases.find((p) => p.status === 'running') ?? phases.find((p) => p.status === 'awaiting_input') ?? phases.find((p) => p.status === 'failed' || p.status === 'crashed') ?? null)?.phase ?? null;
	const pick_phase = (name: string) => { set_step(null); set_phase_pick(name); };
	// The side panel (S6): a phase's full output, what happened, its logs, what it is.
	const [inspect, set_inspect] = useState<Inspect | null>(null);
	const defs = useMemo(() => new Map((data.phase_defs ?? []).map((d) => [d.name, d])), [data.phase_defs]);
	const phase_names = useMemo(() => new Set(phases.map((p) => p.phase)), [phases]);
	// The failure and the open Hugs show inside their phase; only one about a phase not on this list stays on top.
	const failure_phase = data.failure && data.failure.chain.length <= 1 ? phases.find((p) => p.phase === data.failure!.chain[0]?.phase) : undefined;
	const failure_in_list = Boolean(failure_phase && (failure_phase.status === 'failed' || failure_phase.status === 'crashed'));
	const hugs_elsewhere = (data.hugs ?? []).filter((h) => !h.phase || !phase_names.has(h.phase));
	// Workflow view: the run's phases on the team's graph, coloured by how each went.
	const graph_phases = useMemo<Team_phase[]>(() => (telemetry?.phases ?? []).map((x) => ({
		name: x.name, type: x.type ?? (x.sub_runs?.length ? 'team' : 'standard'), agent: null, depends_on: x.depends_on, review: x.kind === 'human' || x.kind === 'gate',
		reviewers: null, max_iterations: null, commands: [], sources: [], targets: [], team: null, role: null, support: false,
	})), [telemetry]);
	const awaiting = run.state === 'awaiting_input';
	const failed = run.state === 'failed' || run.state === 'crashed';
	const completed = run.state === 'completed';
	const pending = run.pending_control ?? null;
	const state_lost = Boolean(run.state_lost_at);
	const can_resume = (failed || awaiting) && !state_lost;
	const again_target = parse_team_id(run.team_id);
	const inputs = parse_inputs(run.inputs);
	// A sub-team run reads as its team ("design-lld"), with its run name beside it.
	const sub_team_name = data.parent ? (run.team_label ?? '').replace(/^@[^/]+\//, '') : '';

	async function control(kind: 'cancel' | 'resume', path: string, body: Record<string, unknown>, on_ok: (payload: unknown) => string) {
		set_error(null);
		set_busy(kind);
		try {
			const res = await auth_fetch(path, { method: 'POST', body: JSON.stringify({ run_id: run.run_id, ...body }) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) {
				set_error({ message: api_message(payload, 'Request failed'), code: api_code(payload) });
				return;
			}
			set_notice(on_ok(payload));
			set_panel(null);
			await reload();
		} catch {
			set_error({ message: 'Network error — check your connection.', code: null });
		} finally {
			set_busy(null);
		}
	}

	const cancel = () => control('cancel', '/v1/runs/cancel', {}, (payload) => {
		const p = payload as { mode?: string; data?: { mode?: string } };
		const mode = p.data?.mode ?? p.mode;
		if (mode === 'hub_terminated') return 'Run marked cancelled on the Hub (daemon unreachable). If cliqd is still running the process, restart it to stop the work.';
		if (mode === 'already_terminal') return 'Run was already finished.';
		return 'Cancel queued — waiting on the daemon to pick it up.';
	});
	// Core's runs/resume drops repeats by `tx_id` and refuses a call without one ("tx_id is required"): one per click.
	const resume = (from_phase: string) => control('resume', '/v1/runs/resume', { from_phase, tx_id: crypto.randomUUID() }, () => `Resume queued from '${from_phase}' — waiting on the daemon to pick it up.`);

	const run_link = (id: string) => `${base}/runs/${encodeURIComponent(id)}`;
	// Everything the phase-by-phase view needs (PLAN-run-page S2–S6).
	const story: Story_props = {
		phases,
		defs,
		run_state: run.state,
		telemetry: telemetry ?? null,
		outputs: outputs_by_phase,
		handoffs: handoffs_by_phase,
		artifacts: data.artifacts ?? [],
		artifacts_status: data.sections.artifacts,
		children: children_by_phase,
		child_link: other_run_link,
		run_link,
		rounds: rounds_by_phase,
		route_backs: run.route_backs ?? [],
		hugs: (data.hugs ?? []).map((h) => ({ id: h.id, title: h.title, phase: h.phase })),
		failure: data.failure ?? null,
		on_rerun: can_resume && gates.run.ok && pending?.endpoint !== '/v1/resume'
			? (phase) => { set_resume_initial(phase); set_panel('resume'); setTimeout(() => document.querySelector('[data-testid="resume-panel"]')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 0); }
			: null,
		on_inspect: (i) => { pick_phase(i.phase); set_inspect(i); },
		inspecting: inspect?.phase ?? null,
		on_answered: () => { set_notice('Answer sent. The run carries on.'); void reload(); },
		resumed: (data.attempts?.length ?? 0) > 1,
		tree: { open: tree_open_now, toggle: toggle_tree, selected: step ? { run_id: step.run.run_id, phase: step.phase.name } : null, on_select: set_step, run_href: run_link },
	};

	const wait_title = (what: string) => (pending?.last_error
		? `Waiting on daemon — ${pending.attempts}/${pending.max_attempts} attempts. Last error: ${pending.last_error}`
		: `Waiting on the daemon to acknowledge the ${what}.`);

	return (
		<div className="flex flex-col gap-4">
			{/* Header */}
			<div className="flex flex-wrap items-start gap-4">
				<div className="min-w-0 flex-1">
					{/* The realm's name is the page title; the run gets a small one under "All runs". */}
					<nav aria-label="Back to runs" className="mb-0.5 text-[12.5px] text-[var(--g-ink-3)]"><Link to={`${base}/runs`} className="hover:text-[var(--g-ink)]">All runs</Link> ›</nav>
					{data.parent ? (
						<nav aria-label="Part of" data-testid="parent-crumb" className="mb-1 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--g-ink-3)]">
							<span aria-hidden>↰</span>
							{(data.ancestors?.length ? data.ancestors : [data.parent]).map((a, i) => (
								<span key={a.run_id} className="contents">
									{i > 0 ? <span aria-hidden>›</span> : null}
									<Link to={other_run_link(a)} className={`hover:underline ${i === 0 ? 'font-semibold text-[var(--g-acc)]' : 'text-[var(--g-acc)]'}`}>{a.run_name || a.run_id}</Link>
									{a.phase ? <><span aria-hidden>›</span><span className="g-mono">{a.phase}</span></> : null}
								</span>
							))}
							<span aria-hidden>›</span><span>this sub-team run</span>
							{data.parent.state ? <span className="ml-1"><State_pill state={data.parent.state} /></span> : null}
						</nav>
					) : null}
					<div className="flex flex-wrap items-center gap-2.5">
						<h2 className="g-mono min-w-0 truncate text-[14px] font-semibold" data-testid="run-title">{run_title(run, Boolean(data.parent))}</h2>
						{sub_team_name && run.run_name ? <span className="g-mono text-[13px] text-[var(--g-ink-3)]">{run.run_name}</span> : null}
						<State_pill state={run.state} />
						<Origin_badge origin={run.origin} />
					</div>
					{/* Everything about the run, once: team and version, when, how long, what it cost. */}
					<p className="mt-1 flex flex-wrap items-center gap-x-1 text-[12.5px] text-[var(--g-ink-3)]" data-testid="run-meta">
						<span>{[run.team_label || run.team_id, run.team_version ? `v${run.team_version}` : null, run.current_phase && live ? `in ${run.current_phase}` : null, run.started_at ? `started ${relative_time(run.started_at)}${person_name(run.started_by) ? ` by ${person_name(run.started_by)}` : ''}` : null, run.started_at ? `${live ? 'running for' : 'took'} ${format_duration((run.completed_at ?? Date.now()) - run.started_at)}` : null, telemetry?.totals.cost_usd != null ? fmt_usd(telemetry.totals.cost_usd) : null, telemetry?.totals.tokens_in ? `${fmt_count(telemetry.totals.tokens_in)} in · ${fmt_count(telemetry.totals.tokens_out)} out` : null].filter(Boolean).join(' · ')}</span>
						{workflow_href(run) ? <Link to={workflow_href(run)!} className="ml-1 text-[var(--g-acc)] hover:underline" data-testid="run-workflow-link">View workflow ↗</Link> : null}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2" role="group" aria-label="Run actions">
					{live ? (
						pending?.endpoint === '/v1/cancel'
							? <button type="button" disabled aria-disabled className={BTN_WAIT} title={wait_title('cancel')}>Cancel pending…</button>
							: <button type="button" className={`${BTN} disabled:cursor-not-allowed disabled:opacity-45`} disabled={!gates.cancel.ok} title={gates.cancel.reason ?? undefined} onClick={() => set_panel((p) => (p === 'cancel' ? null : 'cancel'))}>Cancel</button>
					) : null}
					{can_resume ? (
						pending?.endpoint === '/v1/resume'
							? <button type="button" disabled aria-disabled className={BTN_WAIT} title={wait_title('resume')}>Resume pending…</button>
							: <button type="button" className={`${BTN} disabled:cursor-not-allowed disabled:opacity-45`} disabled={!gates.run.ok} title={gates.run.reason ?? undefined} onClick={() => { set_resume_initial(data.failure?.resume_from ?? null); set_panel((p) => (p === 'resume' ? null : 'resume')); }}>Resume from…</button>
					) : null}
					{(failed || completed || state_lost) && again_target ? (
						<button type="button" className={`${BTN} disabled:cursor-not-allowed disabled:opacity-45`} disabled={!gates.run.ok} onClick={() => { set_panel(null); set_run_again(true); }} title={gates.run.reason ?? 'Start a fresh run — inputs are copied from this run'}>Run again</button>
					) : null}
				</div>
			</div>

			{/* Banners — most decisive first */}
			{notice ? (
				<Banner tone="ok" title={notice} action={<button type="button" aria-label="Dismiss" onClick={() => set_notice(null)} className="text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">×</button>} />
			) : null}
			{error ? (
				<Banner
					tone="bad"
					role="alert"
					title={error.message}
					action={
						<div className="flex gap-2">
							{error.code && STRANDED_CODES.has(error.code) && again_target ? (
								<button type="button" className={BTN} onClick={() => { set_error(null); set_run_again(true); }}>Run again</button>
							) : null}
							<button type="button" aria-label="Dismiss error" onClick={() => set_error(null)} className="text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">×</button>
						</div>
					}
				/>
			) : null}
			{state_lost ? (
				<Banner
					tone="bad"
					role="alert"
					testid="orphaned-run-banner"
					title="The daemon lost this run’s local state"
					action={again_target ? <button type="button" className={BTN} onClick={() => set_run_again(true)}>Run again</button> : null}
				>
					The daemon that owned this run restarted and its storage was wiped. Phase records and workspace files are gone on every daemon, so Resume can’t recover them. Start a fresh run with the same inputs.
				</Banner>
			) : run.force_terminate?.already_terminated ? (
				<Force_banner status={run.force_terminate} />
			) : pending ? (
				<Pending_banner pending={pending} daemon_id={run.daemon_id ?? null} />
			) : null}
			{hugs_elsewhere.length ? (
				<Banner
					tone="warn"
					testid="run-hugs-banner"
					title={hugs_elsewhere.length === 1 ? `Waiting on a person: ${hugs_elsewhere[0].title}` : `${hugs_elsewhere.length} HUGs are waiting on this run`}
					action={<Link to={hug_href(hugs_elsewhere[0].id)} className={BTN_PRIMARY}>{hugs_elsewhere[0].responded ? 'Open' : 'Answer'}</Link>}
				>
					<>Phase <span className="g-mono">{hugs_elsewhere[0].phase}</span> · </>asked {relative_time(hugs_elsewhere[0].created_at)}
				</Banner>
			) : null}
			{data.partial ? (
				<p role="status" className="text-[12px] text-[var(--g-warn-text)]">
					Some details couldn’t be loaded ({(Object.keys(data.sections) as Array<keyof Run_detail_data['sections']>).filter((k) => data.sections[k]?.status === 'error').join(', ')}).
				</p>
			) : null}

			{panel === 'cancel' ? <Cancel_panel busy={busy === 'cancel'} on_confirm={() => void cancel()} on_cancel={() => set_panel(null)} /> : null}
			{panel === 'resume' ? <Resume_panel phases={phases} initial={resume_initial} busy={busy === 'resume'} on_submit={(p) => void resume(p)} on_cancel={() => set_panel(null)} /> : null}

			<Attempts_strip attempts={data.attempts} source={data.attempts_source} />

			{data.failure && failure_in_list ? null : data.failure ? (
				<Run_failure_card
					failure={data.failure}
					run_href={(id) => `${base}/runs/${id}`}
					can_run={gates.run.ok}
				/>
			) : run.error ? (
				<div className="g-mono whitespace-pre-wrap break-words rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] px-4 py-3 text-[12px] text-[var(--g-ink)]" data-testid="run-error">{run.error}</div>
			) : null}

			<section className="min-w-0 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-label="Run">
				<div className="flex flex-wrap items-center gap-2 border-b border-[var(--g-line)] px-4 py-2">
					<h3 className="text-[13px] font-semibold">Phases <span className="font-normal text-[var(--g-ink-3)]">{phases.length}</span></h3>
					{tab === 'phases' && sub_runs_all.length ? (
						<span className="flex gap-3 text-[12px] text-[var(--g-ink-3)]">
							<button type="button" onClick={() => set_tree_open(all_sub_runs(sub_runs_all))} className="hover:text-[var(--g-ink)]">Expand all</button>
							<button type="button" onClick={() => set_tree_open(new Set())} className="hover:text-[var(--g-ink)]">Collapse all</button>
						</span>
					) : null}
					<div role="tablist" aria-label="Run views" className="ml-auto flex gap-1 rounded-lg border border-[var(--g-line)] p-0.5">
						{TABS.map((t) => (
							<button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => set_tab(t)} className={`rounded-md px-2.5 py-0.5 text-[12px] font-semibold ${tab === t ? 'bg-[var(--g-soft)] text-[var(--g-ink)]' : 'text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>
								{TAB_LABEL[t]}
							</button>
						))}
					</div>
				</div>
				{telemetry_read.status === 'error' && !telemetry ? <p role="status" className="px-4 pt-2 text-[11.5px] text-[var(--g-ink-3)]">{telemetry_read.error}</p> : null}
				<div role="tabpanel">
					{tab === 'phases' ? (
						<>
							{step ? <div className="border-b border-[var(--g-line)] p-3"><Step_details step={step} top={run.run_name || run.run_id} failure={data.failure ?? null} run_href={(id) => `${base}/runs/${encodeURIComponent(id)}`} on_close={() => set_step(null)} /></div> : null}
							<div className={inspect ? 'grid gap-3 p-2 xl:grid-cols-[minmax(0,1fr)_460px]' : ''}>
								<div className="min-w-0">
									<Run_story {...story} />
								</div>
								{inspect ? (
									<Phase_panel
										inspect={inspect}
										set_tab={(t) => set_inspect((cur) => (cur ? { ...cur, tab: t } : cur))}
										on_close={() => set_inspect(null)}
										x={story}
										realm_id={data.realm?.id ?? null}
										run_id={run.run_id}
										live={live}
									/>
								) : null}
							</div>
						</>
					) : tab === 'graph' ? (
						graph_phases.length ? (
							<div className="px-2 py-3" data-testid="run-workflow">
								<Workflow_graph phases={graph_phases} statuses={Object.fromEntries(phases.map((p) => [p.phase, p.status]))} selected={phase_sel} on_select={(n) => { pick_phase(n); set_inspect({ phase: n, tab: 'output' }); set_tab('phases'); }} height={320} label="Run workflow" />
								<p className="px-2 pt-2 text-[11.5px] text-[var(--g-ink-3)]">Click a phase to open it in the Run view.</p>
							</div>
						) : <p className="px-4 py-6 text-[13px] text-[var(--g-ink-3)]">{telemetry_read.status === 'loading' ? 'Loading the workflow…' : 'The workflow isn’t available for this run.'}</p>
					) : tab === 'timeline' ? (
						!telemetry ? <div className="h-[320px] animate-pulse" aria-busy="true" aria-label="Loading timeline" /> : (
							<div className="p-3">
								<Timeline t={telemetry} selected={null} on_select={(b) => { if (b?.phase) { pick_phase(b.phase); set_inspect({ phase: b.phase, tab: 'output' }); set_tab('phases'); } }} attempts={data.attempts ?? null} run_href={run_link} />
							</div>
						)
					) : tab === 'usage' ? (
						!telemetry ? <div className="h-[320px] animate-pulse" aria-busy="true" aria-label="Loading usage" /> : <div className="p-3"><Usage t={telemetry} /></div>
					) : tab === 'details' ? (
						<div className="p-4"><Details run={run} base={base} parent={data.parent ?? null} run_link={other_run_link} /></div>
					) : data.realm ? (
						<div className="h-[560px]"><G_run_logs key={log_q ?? ''} run_id={run.run_id} realm_id={data.realm.id} live={live} initial_query={log_q ?? undefined} sub_runs={(data.children ?? []).map((c) => ({ run_id: c.run_id, label: (c.team_label ?? c.run_name ?? c.run_id).replace(/^@[^/]+\//, '') }))} /></div>
					) : (
						<p className="px-4 py-6 text-[13px] text-[var(--g-ink-3)]">Logs are unavailable because this run’s realm couldn’t be loaded.</p>
					)}
				</div>
			</section>

			{run_again && again_target && data.realm ? (
				<Run_in_realm_dialog
					scope={again_target.scope}
					slug={again_target.slug}
					fixed_realm={{ id: data.realm.id, slug: data.realm.slug, name: data.realm.name, org_id: realm_org_id }}
					prefill_from={{ inputs: inputs ?? {}, run_name: run.run_name ? `${run.run_name} (rerun)` : null, source_run_id: run.run_id }}
					on_close={() => { set_run_again(false); void reload(); }}
				/>
			) : null}
		</div>
	);
}

function Skeleton() {
	return (
		<div className="space-y-4" aria-busy="true" aria-label="Loading run">
			<div className="h-10 w-80 animate-pulse rounded bg-[var(--g-panel)]" />
			<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
				<div className="h-[360px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" />
				<div className="h-[260px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" />
			</div>
		</div>
	);
}

export function Component() {
	const { org = '', slug = '', run_id = '' } = useParams();
	const overview = use_overview();
	const access = use_access(overview.data);
	const [refresh_ms, set_refresh_ms] = useState(LIVE_POLL_MS);
	const detail = use_bff_read<Run_detail_data>(
		'/v1/run_detail/get',
		run_id ? { run_id } : null,
		{ refresh_ms, fallback_error: 'Could not load this run.' },
	);
	const data = detail.data;
	const live = is_live_state(data?.run.state);
	useEffect(() => {
		if (data) set_refresh_ms(live ? LIVE_POLL_MS : IDLE_POLL_MS);
	}, [data, live]);

	// A run opened under the wrong realm URL moves to its real home.
	const realm = data?.realm ?? null;
	if (realm?.org_slug && (realm.slug !== slug || realm.org_slug !== org)) {
		return <Navigate to={`${run_href(realm.org_slug, realm.slug, run_id)}${window.location.search}`} replace />;
	}

	const sidebar_realm = overview.data?.orgs.flatMap((o) => o.realms).find((r) => r.id === realm?.id) ?? null;
	const gates: Run_gates = {
		cancel: access.realm(realm?.id, 'operate', 'teams.cancel'),
		run: access.realm(realm?.id, 'operate', 'teams.run'),
	};

	return (
		<Graphite_shell
			data={overview.data}
			current_realm_id={realm?.id ?? null}
			title={data ? data.run.run_name || data.run.run_id : 'Run'}
			actions={
				<button
					type="button"
					onClick={() => void detail.reload()}
					className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"
					aria-label="Refresh"
					title="Refresh"
				>
					<RefreshCw className="h-3.5 w-3.5" />
				</button>
			}
		>
			<Realm_nav org_slug={org} slug={slug} realm={sidebar_realm} item={data ? run_title(data.run, Boolean(data.parent)) : null}>
			<div className="min-w-0">
				{detail.status === 'loading' ? <Skeleton /> : null}
				{detail.status === 'error' && data ? (
					<p role="status" className="mb-3 text-[12px] text-[var(--g-warn-text)]">Showing the last loaded data — {detail.error}</p>
				) : null}
				{detail.status === 'error' && !data ? (
					<Blocking_error http_status={detail.http_status} code={detail.code} error={detail.error} on_retry={() => void detail.reload()} what="run" />
				) : null}
				{data ? <Run_view data={data} org_slug={org} slug={slug} reload={detail.reload} gates={gates} realm_org_id={sidebar_realm?.org_id ?? null} /> : null}
			</div>
			</Realm_nav>
		</Graphite_shell>
	);
}
