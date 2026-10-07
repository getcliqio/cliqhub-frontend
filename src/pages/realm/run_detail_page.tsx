/**
 * Run detail (Graphite).
 *
 * Data: one `POST /v1/run_detail/get { run_id }` per poll (BFF composes the
 * run row, phases, labels, realm, this run's pending reviews and its stored
 * artifacts). Polls every
 * 4s while the run is live, 20s otherwise.
 *
 * Control actions stay on the existing Core routes:
 *   /v1/runs/supply_inputs · /v1/runs/cancel · /v1/runs/resume
 * "Run again" reuses Run_in_realm_dialog (prefilled from this run).
 * Telemetry (summary strip, Timeline, Usage, DAG): one `POST /v1/run_telemetry/get`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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
	type Run_detail_data,
	type Run_artifact,
	type Run_detail_phase,
	type Run_phase_output,
	type Run_row,
} from '@/lib/realm_inbox';
import { realm_path } from '@/lib/realm_url';
import { format_datetime } from '@/lib/format_time';
import { parse_kv_lines, pick_default_resume_phase } from '@/components/dispatch/run_dialogs';
import { Run_in_realm_dialog } from '@/components/run_in_realm_dialog';
import { sort_phases_workflow } from '@/components/runs/run_phases_panel';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Realm_nav } from '@/components/graphite/realm_nav';
import { State_dot, State_pill } from '@/components/graphite/g_status';
import { G_run_logs } from '@/components/graphite/g_run_logs';
import { G_run_artifacts } from '@/components/graphite/g_run_artifacts';
import { G_phase_output, download_raw_outputs } from '@/components/graphite/g_phase_output';
import { Dag, Phase_clock, Span_details, Summary_strip, Timeline, Usage } from '@/components/graphite/g_telemetry';
import { fmt_count, fmt_usd, type Run_telemetry_data, type Telemetry_bar, type Telemetry_phase } from '@/lib/run_telemetry';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

export const LIVE_POLL_MS = 4_000;
export const IDLE_POLL_MS = 20_000;

/** Codes for which the only path forward is "Run again". */
const STRANDED_CODES = new Set(['run/stranded', 'run/daemon_stranded']);

type Tab = 'phases' | 'timeline' | 'usage' | 'dag' | 'logs';
const TABS: Tab[] = ['phases', 'timeline', 'usage', 'dag', 'logs'];
const TAB_LABEL: Record<Tab, string> = { phases: 'Phases', timeline: 'Timeline', usage: 'Usage', dag: 'DAG', logs: 'Logs' };
type Panel = null | 'supply' | 'cancel' | 'resume';

/** `scope/slug` team id → parts for "Run again"; null hides the action. */
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
	if (endpoint === '/v1/runs/supply_inputs') return 'Supply inputs';
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
/* Phases                                                              */

function phase_duration(p: Run_detail_phase, now: number): string {
	if (!p.started_at) return '';
	return format_duration((p.completed_at ?? now) - p.started_at);
}

function Phase_list({ phases, run_state, telemetry, on_open, outputs, handoffs, run_link }: {
	phases: Run_detail_phase[];
	run_state: string;
	telemetry?: Run_telemetry_data | null;
	on_open?: (phase: string) => void;
	/** Each phase's recorded outputs, oldest first. */
	outputs?: Map<string, Run_phase_output[]>;
	handoffs?: Map<string, Run_artifact[]>;
	run_link?: (run_id: string) => string;
}) {
	const tel = new Map<string, Telemetry_phase>((telemetry?.phases ?? []).map((x) => [x.name, x]));
	const [shown, set_shown] = useState<Set<string>>(() => new Set());
	const now = Date.now();
	if (phases.length === 0) {
		return <p className="px-4 py-8 text-center text-[13px] text-[var(--g-ink-3)]">No phases recorded yet{is_live_state(run_state) ? ' — the daemon hasn’t reported any progress.' : '.'}</p>;
	}
	return (
		<ol className="relative py-2" aria-label="Phases">
			{phases.map((p, i) => {
				const live = p.status === 'running';
				const mine = outputs?.get(p.phase) ?? [];
				const latest = mine[mine.length - 1];
				const open = Boolean(latest) && shown.has(p.phase);
				return (
					<li key={`${p.phase}-${i}`} className={`relative grid grid-cols-[28px_minmax(0,1fr)_auto] gap-3 sm:grid-cols-[28px_minmax(0,1fr)_200px_64px_52px] px-4 py-2.5 ${on_open && tel.get(p.phase)?.start_ms != null ? 'cursor-pointer hover:bg-[var(--g-soft)]' : ''}`} data-testid="phase-row" onClick={() => { if (on_open && tel.get(p.phase)?.start_ms != null) on_open(p.phase); }}>
						{i < phases.length - 1 ? <span aria-hidden className="absolute left-[29px] top-[26px] h-[calc(100%-12px)] w-px bg-[var(--g-line)]" /> : null}
						<span className="relative z-[1] mt-1 grid h-4 w-4 place-items-center justify-self-center rounded-full bg-[var(--g-panel)]">
							<State_dot state={p.status} pulse={live} />
						</span>
						<div className="min-w-0">
							<p className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold">
								<span className="g-mono">{p.phase}</span>
								<State_pill state={p.status} />
							</p>
							<p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">
								{[p.agent ? `agent ${p.agent}` : null, p.started_at ? `started ${relative_time(p.started_at)}` : 'not started', tel.get(p.phase)?.tokens_in != null ? `${fmt_count(tel.get(p.phase)!.tokens_in)} / ${fmt_count(tel.get(p.phase)!.tokens_out)} tokens` : null, (tel.get(p.phase)?.runs ?? 1) > 1 ? `ran ${tel.get(p.phase)!.runs}×` : null].filter(Boolean).join(' · ')}
							</p>
							{p.error ? <p className="g-mono mt-1 whitespace-pre-wrap break-words text-[11.5px] text-[var(--g-bad)]">{p.error}</p> : null}
							{latest ? (
								<p className="mt-1 flex min-w-0 items-center gap-2 text-[12.5px] text-[var(--g-ink-2)]">
									<span className="min-w-0 truncate" data-testid="phase-output-summary">{latest.view.summary}</span>
									<button
										type="button"
										aria-expanded={open}
										aria-label={`${open ? 'Hide' : 'Show'} output of ${p.phase}`}
										onClick={(e) => { e.stopPropagation(); set_shown((cur) => { const next = new Set(cur); if (next.has(p.phase)) next.delete(p.phase); else next.add(p.phase); return next; }); }}
										className="shrink-0 rounded border border-[var(--g-line)] px-1.5 py-px text-[11.5px] font-semibold text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"
									>
										{open ? 'Hide output' : 'Output'}
									</button>
								</p>
							) : null}
						</div>
						<span className="hidden sm:block"><Phase_clock p={tel.get(p.phase)} t={telemetry ?? null} /></span>
						<span className="g-mono mt-0.5 text-right text-[12px] text-[var(--g-ink-3)]">{phase_duration(p, now)}</span>
						<span className="g-mono mt-0.5 hidden sm:block w-[52px] text-right text-[12px] text-[var(--g-ink-2)]" data-testid="phase-cost">{telemetry ? fmt_usd(tel.get(p.phase)?.cost_usd ?? null) : ''}</span>
						{open ? (
							<div className="col-span-full cursor-default sm:pl-[40px]" onClick={(e) => e.stopPropagation()}>
								<G_phase_output outputs={mine} handoffs={handoffs?.get(p.phase)} run_link={run_link ?? ((id) => id)} />
							</div>
						) : null}
					</li>
				);
			})}
		</ol>
	);
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

function Details({ run, base }: { run: Run_row; base: string }) {
	const inputs = parse_inputs(run.inputs);
	const labels = Object.entries(run.context_labels ?? {}).filter(([k]) => k !== 'external_url');
	return (
		<aside className="flex flex-col gap-3.5" aria-label="Run details">
			<section className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4">
				<dl className="grid gap-3.5">
					<Field label="Run ID"><Copy_value value={run.run_id} label="run id" /></Field>
					{run.team_label || run.team_id ? <Field label="Team"><span className="g-mono">{run.team_label || run.team_id}</span></Field> : null}
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
						) : <span className="text-[var(--g-warn-text)]">no daemon assigned</span>}
					</Field>
					<div className="grid grid-cols-2 gap-3">
						<Field label="Started"><span title={run.started_at ? format_datetime(run.started_at) : undefined}>{run.started_at ? relative_time(run.started_at) : '—'}</span></Field>
						<Field label="Duration">
							<span className="g-mono">{run.started_at ? format_duration((run.completed_at ?? Date.now()) - run.started_at) : '—'}</span>
						</Field>
					</div>
					{run.completed_at ? <Field label="Finished"><span title={format_datetime(run.completed_at)}>{relative_time(run.completed_at)}</span></Field> : null}
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

function Supply_panel({ busy, on_submit, on_cancel }: { busy: boolean; on_submit: (inputs: Record<string, string>) => void; on_cancel: () => void }) {
	const [raw, set_raw] = useState('');
	const parsed = useMemo(() => parse_kv_lines(raw), [raw]);
	const ready = Object.keys(parsed).length > 0;
	return (
		<section className="rounded-[10px] border border-[rgba(255,178,36,.35)] bg-[var(--g-panel)] p-4" aria-label="Provide input" data-testid="supply-panel">
			<p className="text-[13px] font-semibold">Provide input</p>
			<p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">One <span className="g-mono">key=value</span> per line. The run resumes once the daemon accepts them.</p>
			<textarea
				value={raw}
				onChange={(e) => set_raw(e.target.value)}
				rows={3}
				aria-label="Inputs"
				placeholder={'employer_name=Acme Corp\n# lines starting with # are ignored'}
				className="g-mono mt-3 block w-full rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-3 py-2 text-[12.5px] outline-none focus:border-[var(--g-acc-line)]"
			/>
			<div className="mt-3 flex gap-2">
				<button type="button" disabled={!ready || busy} onClick={() => on_submit(parsed)} className="rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-acc)] disabled:opacity-50">
					{busy ? 'Sending…' : 'Send & resume'}
				</button>
				<button type="button" onClick={on_cancel} className="rounded-md border border-[var(--g-line)] px-3 py-1.5 text-[12.5px]">Close</button>
			</div>
		</section>
	);
}

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

function Resume_panel({ phases, busy, on_submit, on_cancel }: { phases: Run_detail_phase[]; busy: boolean; on_submit: (phase: string) => void; on_cancel: () => void }) {
	const [phase, set_phase] = useState(() => pick_default_resume_phase(phases));
	useEffect(() => set_phase(pick_default_resume_phase(phases)), [phases]);
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

export function Run_view({ data, org_slug, slug, reload }: { data: Run_detail_data; org_slug: string; slug: string; reload: () => Promise<void> }) {
	const auth_fetch = useAuthFetch();
	const { run } = data;
	const base = realm_path(org_slug, slug);
	const [search, set_search] = useSearchParams();
	const tab: Tab = ((v) => (TABS.includes(v as Tab) ? v as Tab : 'phases'))(search.get('tab'));
	const set_tab = useCallback((t: Tab) => {
		set_search((prev) => {
			const p = new URLSearchParams(prev);
			if (t === 'phases') p.delete('tab');
			else p.set('tab', t);
			return p;
		}, { replace: true });
	}, [set_search]);

	const [panel, set_panel] = useState<Panel>(null);
	const [busy, set_busy] = useState<null | 'supply' | 'cancel' | 'resume'>(null);
	const [notice, set_notice] = useState<string | null>(null);
	const [error, set_error] = useState<{ message: string; code: string | null } | null>(null);
	const [run_again, set_run_again] = useState(false);
	const telemetry_read = use_bff_read<Run_telemetry_data>('/v1/run_telemetry/get', { run_id: run.run_id }, { refresh_ms: is_live_state(run.state) ? 8_000 : 0, fallback_error: 'Could not load telemetry.' });
	const telemetry = telemetry_read.data;
	const [selected, set_selected] = useState<Telemetry_bar | null>(null);
	const [focus, set_focus] = useState<string | null>(null);
	const [log_q, set_log_q] = useState<string | null>(null);
	const open_in_timeline = (phase: string) => { set_focus(null); setTimeout(() => set_focus(phase), 0); set_tab('timeline'); };

	const phases = useMemo(() => sort_phases_workflow(data.phases.map((p) => ({ ...p, agent_name: p.agent }))) as unknown as Run_detail_phase[], [data.phases]);
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
	const live = is_live_state(run.state);
	const awaiting = run.state === 'awaiting_input';
	const failed = run.state === 'failed' || run.state === 'crashed';
	const completed = run.state === 'completed';
	const pending = run.pending_control ?? null;
	const state_lost = Boolean(run.state_lost_at);
	const can_resume = (failed || awaiting) && !state_lost;
	const again_target = parse_team_id(run.team_id);
	const inputs = parse_inputs(run.inputs);
	const title = run.run_name || run.run_id;

	async function control(kind: 'supply' | 'cancel' | 'resume', path: string, body: Record<string, unknown>, on_ok: (payload: unknown) => string) {
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

	const supply = (inputs_kv: Record<string, string>) => control('supply', '/v1/runs/supply_inputs', { inputs: inputs_kv }, () => 'Inputs sent — the run should resume shortly.');
	const cancel = () => control('cancel', '/v1/runs/cancel', {}, (payload) => {
		const p = payload as { mode?: string; data?: { mode?: string } };
		const mode = p.data?.mode ?? p.mode;
		if (mode === 'hub_terminated') return 'Run marked cancelled on the Hub (daemon unreachable). If cliqd is still running the process, restart it to stop the work.';
		if (mode === 'already_terminal') return 'Run was already finished.';
		return 'Cancel queued — waiting on the daemon to pick it up.';
	});
	const resume = (from_phase: string) => control('resume', '/v1/runs/resume', { from_phase }, () => `Resume queued from '${from_phase}' — waiting on the daemon to pick it up.`);

	const wait_title = (what: string) => (pending?.last_error
		? `Waiting on daemon — ${pending.attempts}/${pending.max_attempts} attempts. Last error: ${pending.last_error}`
		: `Waiting on the daemon to acknowledge the ${what}.`);

	return (
		<div className="flex flex-col gap-4">
			{/* Header */}
			<div className="flex flex-wrap items-start gap-4">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2.5">
						<h1 className="min-w-0 truncate text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
						<State_pill state={run.state} />
					</div>
					<p className="mt-1 text-[12.5px] text-[var(--g-ink-3)]">
						{[run.team_label || run.team_id, run.current_phase && live ? `in ${run.current_phase}` : null, run.started_at ? `started ${relative_time(run.started_at)}` : null].filter(Boolean).join(' · ')}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2" role="group" aria-label="Run actions">
					{awaiting ? (
						pending?.endpoint === '/v1/runs/supply_inputs'
							? <button type="button" disabled aria-disabled className={BTN_WAIT} title={wait_title('supplied inputs')}>Input pending…</button>
							: <button type="button" className={BTN_PRIMARY} onClick={() => set_panel((p) => (p === 'supply' ? null : 'supply'))}>Provide input</button>
					) : null}
					{live ? (
						pending?.endpoint === '/v1/cancel'
							? <button type="button" disabled aria-disabled className={BTN_WAIT} title={wait_title('cancel')}>Cancel pending…</button>
							: <button type="button" className={BTN} onClick={() => set_panel((p) => (p === 'cancel' ? null : 'cancel'))}>Cancel</button>
					) : null}
					{can_resume ? (
						pending?.endpoint === '/v1/resume'
							? <button type="button" disabled aria-disabled className={BTN_WAIT} title={wait_title('resume')}>Resume pending…</button>
							: <button type="button" className={BTN} onClick={() => set_panel((p) => (p === 'resume' ? null : 'resume'))}>Resume from…</button>
					) : null}
					{(failed || completed || state_lost) && again_target ? (
						<button type="button" className={BTN} onClick={() => { set_panel(null); set_run_again(true); }} title="Start a fresh run — inputs are copied from this run">Run again</button>
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
			{data.reviews.length ? (
				<Banner
					tone="warn"
					testid="run-reviews-banner"
					title={data.reviews.length === 1 ? `Waiting on a review: ${data.reviews[0].title}` : `${data.reviews.length} reviews are waiting on this run`}
					action={<Link to={`/reviews/${encodeURIComponent(data.reviews[0].id)}`} className={BTN_PRIMARY}>Review</Link>}
				>
					{data.reviews[0].phase ? <>Gate <span className="g-mono">{data.reviews[0].phase}</span> · </> : null}requested {relative_time(data.reviews[0].requested_at)}
				</Banner>
			) : null}
			{data.partial ? (
				<p role="status" className="text-[12px] text-[var(--g-warn-text)]">
					Some details couldn’t be loaded ({(Object.keys(data.sections) as Array<keyof Run_detail_data['sections']>).filter((k) => data.sections[k].status === 'error').join(', ')}).
				</p>
			) : null}

			{panel === 'supply' ? <Supply_panel busy={busy === 'supply'} on_submit={(v) => void supply(v)} on_cancel={() => set_panel(null)} /> : null}
			{panel === 'cancel' ? <Cancel_panel busy={busy === 'cancel'} on_confirm={() => void cancel()} on_cancel={() => set_panel(null)} /> : null}
			{panel === 'resume' ? <Resume_panel phases={phases} busy={busy === 'resume'} on_submit={(p) => void resume(p)} on_cancel={() => set_panel(null)} /> : null}

			{run.error ? (
				<div className="g-mono whitespace-pre-wrap break-words rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] px-4 py-3 text-[12px] text-[var(--g-ink)]" data-testid="run-error">{run.error}</div>
			) : null}

			<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
				<div className="flex min-w-0 flex-col gap-2">
					{telemetry || telemetry_read.status !== 'error' ? <Summary_strip t={telemetry} /> : null}
					{telemetry_read.status === 'error' && !telemetry ? <p role="status" className="-mt-1 text-[11.5px] text-[var(--g-ink-3)]">{telemetry_read.error}</p> : null}
					<div role="tablist" aria-label="Run views" className="flex w-fit gap-1 rounded-lg border border-[var(--g-line)] bg-[var(--g-panel)] p-1">
						{TABS.map((t) => (
							<button
								key={t}
								type="button"
								role="tab"
								aria-selected={tab === t}
								onClick={() => set_tab(t)}
								className={`rounded-md px-3 py-1 text-[12.5px] font-semibold capitalize ${tab === t ? 'bg-[var(--g-soft)] text-[var(--g-ink)]' : 'text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}
							>
								{t === 'phases' ? `Phases ${phases.length}` : TAB_LABEL[t]}
							</button>
						))}
					</div>
					<div role="tabpanel">
						{tab === 'phases' ? (
							<section className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
								{phase_outputs.length ? (
									<div className="flex justify-end border-b border-[var(--g-line-2)] px-4 py-1.5">
										<button type="button" onClick={() => download_raw_outputs(run.run_id, phase_outputs)} className="text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">
											Download raw outputs
										</button>
									</div>
								) : null}
								<Phase_list
									phases={phases}
									run_state={run.state}
									telemetry={telemetry}
									on_open={open_in_timeline}
									outputs={outputs_by_phase}
									handoffs={handoffs_by_phase}
									run_link={(id) => `${base}/runs/${encodeURIComponent(id)}`}
								/>
							</section>
						) : tab === 'timeline' || tab === 'usage' || tab === 'dag' ? (
							!telemetry ? <div className="h-[320px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading telemetry" />
								: tab === 'timeline' ? <Timeline t={telemetry} selected={selected?.id ?? null} on_select={set_selected} focus_phase={focus} />
								: tab === 'usage' ? <Usage t={telemetry} />
								: <Dag t={telemetry} on_open={open_in_timeline} />
						) : data.realm ? (
							<div className="h-[560px]"><G_run_logs key={log_q ?? ''} run_id={run.run_id} realm_id={data.realm.id} live={live} initial_query={log_q ?? undefined} /></div>
						) : (
							<p className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-6 text-[13px] text-[var(--g-ink-3)]">Logs are unavailable because this run’s realm couldn’t be loaded.</p>
						)}
					</div>
					<G_run_artifacts artifacts={data.artifacts ?? []} status={data.sections.artifacts} />
				</div>
				{tab === 'timeline' && selected && telemetry
					? <Span_details bar={selected} t={telemetry} realm_id={data.realm?.id ?? null} on_close={() => set_selected(null)} on_logs={(q) => { set_log_q(q); set_tab('logs'); }} />
					: <Details run={run} base={base} />}
			</div>

			{run_again && again_target && data.realm ? (
				<Run_in_realm_dialog
					scope={again_target.scope}
					slug={again_target.slug}
					fixed_realm={{ id: data.realm.id, slug: data.realm.slug, name: data.realm.name }}
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
			<Realm_nav org_slug={org} slug={slug} realm={sidebar_realm} />
			<div className="px-7 py-6">
				{detail.status === 'loading' ? <Skeleton /> : null}
				{detail.status === 'error' && data ? (
					<p role="status" className="mb-3 text-[12px] text-[var(--g-warn-text)]">Showing the last loaded data — {detail.error}</p>
				) : null}
				{detail.status === 'error' && !data ? (
					<Blocking_error http_status={detail.http_status} code={detail.code} error={detail.error} on_retry={() => void detail.reload()} what="run" />
				) : null}
				{data ? <Run_view data={data} org_slug={org} slug={slug} reload={detail.reload} /> : null}
			</div>
		</Graphite_shell>
	);
}
