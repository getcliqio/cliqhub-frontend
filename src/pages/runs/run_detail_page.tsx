import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router';
import { Copy, Check as CheckIcon, Radio } from 'lucide-react';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { Confirm_action } from '@/components/dispatch/confirm_action';
import { Supply_inputs_dialog, Resume_from_phase_dialog } from '@/components/dispatch/run_dialogs';
import { Run_logs_section } from '@/components/runs/run_logs_section';
import { Run_phases_panel, sort_phases_workflow, type Run_phase_row } from '@/components/runs/run_phases_panel';
import { Run_summary_strip } from '@/components/runs/run_summary_strip';
import { UsageBreakdownTable } from '@/components/runs/usage_breakdown_table';
import { Run_timeline_panel } from '@/components/runs/run_timeline_panel';
import { DagPanel } from '@/components/observability/dag_panel';
import { normalize_phases_for_dag } from '@/pages/runs/phase_dag_adapter';
import { Run_in_realm_dialog } from '@/components/run_in_realm_dialog';
import { use_busy } from '@/lib/use_busy';
import { use_poll } from '@/lib/use_poll';
import { format_datetime } from '@/lib/format_time';
import type { Realm_outlet_context } from '@/layouts/realm_layout';
import { hub_list, hub_payload } from '@/lib/hub_envelope';

type Detail_tab = 'logs' | 'timeline' | 'dag';

/** Tabs are user-selectable AND deep-linkable via ?tab= — pin the allowed set. */
const VALID_DETAIL_TABS: readonly Detail_tab[] = ['logs', 'timeline', 'dag'];

function parse_tab_param(raw: string | null): Detail_tab | null {
	if (!raw) return null;
	return (VALID_DETAIL_TABS as readonly string[]).includes(raw) ? (raw as Detail_tab) : null;
}

/**
 * In-flight control command targeting this run. Populated by the
 * backend from `cliq.command_outbox` and used by the run detail
 * page to show a persistent "Cancel queued — waiting on daemon"
 * banner and disable the Cancel button, so the operator isn't left
 * wondering "did anything happen?" after clicking Cancel.
 */
interface Pending_control {
	tx_id: string;
	/** '/v1/cancel' | '/v1/runs/supply_inputs' | '/v1/resume' | '/v1/execute' */
	endpoint: string;
	enqueued_at: number;
	attempts: number;
	max_attempts: number;
	/** Non-null once the Hub worker POSTed to the daemon; null while queued. */
	delivered_at: number | null;
	last_error: string | null;
	ack_status: string | null;
}

/**
 * Hub-side cancel attribution when cancel escalated because the daemon
 * was unreachable. Banner only — Cancel itself does the escalate.
 */
interface Force_terminate_status {
	already_terminated: boolean;
	terminated_at: number | null;
	terminated_by_user_id: string | null;
	terminated_reason: string | null;
	eligible: boolean;
	trigger: 'stale_cancel' | 'daemon_offline' | 'lease_expired' | null;
	blocker: string | null;
}

interface RunDetail {
	run_id: string;
	run_name?: string | null;
	state: string;
	daemon_id?: string | null;
	team_id?: string | null;
	workspace_id?: string | null;
	external_id?: string | null;
	context_labels?: Record<string, string> | null;
	started_at?: number | null;
	completed_at?: number | null;
	error?: string | null;
	inputs?: string | Record<string, unknown> | null;
	pending_control?: Pending_control | null;
	force_terminate?: Force_terminate_status | null;
	// Set when a dispatched command came back from the daemon with
	// `run_not_found` — the daemon's ephemeral pod storage was wiped
	// and the run's phase records are gone. Presence flips the page
	// from "Resume" to "Run again" as the only meaningful action.
	state_lost_at?: number | null;
}

/**
 * "Run again" needs the team's `scope` + `slug` — which live on the
 * run row as a single `team_id` field shaped like `scope/slug`.
 * Returns `null` when the field is missing or malformed so the
 * caller can hide the action rather than open a dialog that can't
 * function.
 */
export function parse_team_id(team_id: string | null | undefined): { scope: string; slug: string } | null {
	if (!team_id) return null;
	const trimmed = team_id.trim();
	if (!trimmed) return null;
	const parts = trimmed.split('/');
	if (parts.length !== 2) return null;
	const [scope, slug] = parts;
	if (!scope || !slug) return null;
	return { scope, slug };
}

function parse_inputs(raw: RunDetail['inputs']): Record<string, unknown> | null {
	if (!raw) return null;
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (!trimmed) return null;
		try {
			const v = JSON.parse(trimmed);
			return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
		} catch {
			return null;
		}
	}
	if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
	return null;
}

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

/**
 * Error envelope machine-readable tag. `null` when the backend didn't
 * set one (older endpoints, unrelated errors). Codes we care about:
 *   run/stranded         — no daemon assignment; must Run again.
 *   run/daemon_stranded  — daemon dead / gone > 24h; must Run again.
 *   run/daemon_offline   — transient; user should wait and retry.
 */
function api_error_code(data: { code?: string | null }): string | null {
	const raw = data?.code;
	return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** Codes for which the only path forward is "Run again". */
const _STRANDED_CODES = new Set(['run/stranded', 'run/daemon_stranded']);

function status_classes(state: string): string {
	if (state === 'completed' || state === 'done' || state === 'ok') return 'bg-emerald-100 text-emerald-800';
	if (state === 'failed' || state === 'crashed') return 'bg-rose-100 text-rose-800';
	if (state === 'running') return 'bg-sky-100 text-sky-800';
	if (state === 'awaiting_input') return 'bg-amber-100 text-amber-900';
	return 'bg-slate-100 text-slate-600';
}

function format_relative(ts: number | null | undefined): string {
	if (!ts || ts <= 0) return '—';
	const age_s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
	if (age_s < 60) return `${age_s}s ago`;
	if (age_s < 3600) return `${Math.floor(age_s / 60)}m ago`;
	if (age_s < 86400) return `${Math.floor(age_s / 3600)}h ago`;
	return `${Math.floor(age_s / 86400)}d ago`;
}

export function Component() {
	const { realm, base_path } = useOutletContext<Realm_outlet_context>();
	const { run_id = '' } = useParams();
	const auth_fetch = useOrgFetch();
	const { is_busy, run_busy } = use_busy();
	const [run, set_run] = useState<RunDetail | null>(null);
	const [phases, set_phases] = useState<Run_phase_row[]>([]);
	const [team_label, set_team_label] = useState<string | null>(null);
	const [workspace_name, set_workspace_name] = useState<string | null>(null);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);
	// Machine-readable tag for the current error (e.g. `run/stranded`).
	// Drives the "Run again" affordance in the error banner without
	// string-matching on the human message.
	const [error_code, set_error_code] = useState<string | null>(null);
	const [notice, set_notice] = useState<string | null>(null);
	const [show_supply, set_show_supply] = useState(false);
	const [show_cancel, set_show_cancel] = useState(false);
	const [show_resume, set_show_resume] = useState(false);
	// "Run again" opens Run_in_realm_dialog prefilled with the prior
	// run's inputs (slice 3.1) — replacing the old "Link to the
	// daemon page" behaviour which forced users to re-type everything.
	const [show_run_again, set_show_run_again] = useState(false);
	const [copied_id, set_copied_id] = useState(false);
	const [copied_daemon, set_copied_daemon] = useState(false);
	const [copied_workspace, set_copied_workspace] = useState(false);
	const [copied_external, set_copied_external] = useState(false);
	const [selected_phase, set_selected_phase] = useState<string | null>(null);
	// Detail tab is deep-linkable via `?tab=<name>` so e.g. the
	// `/live` redirect can drop users straight into the DAG. Default
	// stays "timeline" for anyone landing without a query param, which
	// matches the pre-unification behaviour.
	const [search_params, set_search_params] = useSearchParams();
	const initial_tab: Detail_tab = parse_tab_param(search_params.get('tab')) ?? 'timeline';
	const [detail_tab, set_detail_tab_state] = useState<Detail_tab>(initial_tab);
	const set_detail_tab = useCallback((next: Detail_tab) => {
		set_detail_tab_state(next);
		set_search_params((prev) => {
			const params = new URLSearchParams(prev);
			if (next === 'timeline') {
				params.delete('tab');
				return params;
			}
			params.set('tab', next);
			return params;
		}, { replace: true });
	}, [set_search_params]);

	const load = useCallback(async (opts?: { silent?: boolean }) => {
		if (!run_id) return;
		if (!opts?.silent) set_loading(true);
		try {
			const [run_res, phases_res, list_res] = await Promise.all([
				auth_fetch('/v1/runs/get_by_id', {
					method: 'POST',
					body: JSON.stringify({ run_id }),
				}),
				auth_fetch('/v1/runs/get_status', {
					method: 'POST',
					body: JSON.stringify({ run_id }),
				}),
				auth_fetch('/v1/runs/get', {
					method: 'POST',
					body: JSON.stringify({ query: run_id, limit: 5, realm_id: realm.id }),
				}),
			]);
			const [run_data, phases_data, list_data] = await Promise.all([
				run_res.json(),
				phases_res.json(),
				list_res.json(),
			]);
			if (!run_data.ok) {
				if (!opts?.silent) set_error(api_error_message(run_data));
				return;
			}
			set_run(hub_payload(run_data, 'run') ?? null);
			if (phases_data.ok) {
				set_phases(sort_phases_workflow(hub_list<Run_phase_row>(phases_data, 'phases')));
			}
			if (list_data.ok) {
				const page = hub_payload<{ items?: Array<{ run_id: string; team_label?: string | null; workspace_name?: string | null }> }>(list_data);
				const list = Array.isArray(list_data.data)
					? (list_data.data as Array<{ run_id: string; team_label?: string | null; workspace_name?: string | null }>)
					: (page?.items ?? []);
				const match = list.find((r) => r.run_id === run_id);
				set_team_label(match?.team_label ?? null);
				set_workspace_name(match?.workspace_name ?? null);
			}
			set_error(null);
		} catch {
			if (!opts?.silent) set_error('Failed to load run');
		} finally {
			if (!opts?.silent) set_loading(false);
		}
	}, [auth_fetch, run_id, realm.id]);

	async function copy_run_id() {
		try {
			await navigator.clipboard.writeText(run?.run_id ?? run_id);
			set_copied_id(true);
			setTimeout(() => set_copied_id(false), 1200);
		} catch {
			/* ignore */
		}
	}

	async function copy_daemon_id() {
		if (!run?.daemon_id) return;
		try {
			await navigator.clipboard.writeText(run.daemon_id);
			set_copied_daemon(true);
			setTimeout(() => set_copied_daemon(false), 1200);
		} catch {
			/* ignore */
		}
	}

	async function copy_workspace_id() {
		if (!run?.workspace_id) return;
		try {
			await navigator.clipboard.writeText(run.workspace_id);
			set_copied_workspace(true);
			setTimeout(() => set_copied_workspace(false), 1200);
		} catch {
			/* ignore */
		}
	}

	async function copy_external_id() {
		if (!run?.external_id) return;
		try {
			await navigator.clipboard.writeText(run.external_id);
			set_copied_external(true);
			setTimeout(() => set_copied_external(false), 1200);
		} catch {
			/* ignore */
		}
	}

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (loading || !run) return;
		if (window.location.hash !== '#logs') return;
		requestAnimationFrame(() => {
			document.getElementById('logs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
	}, [loading, run]);

	const is_live = run?.state === 'running' || run?.state === 'awaiting_input';
	use_poll(() => void load({ silent: true }), is_live ? 4_000 : 20_000, !loading && Boolean(run));

	async function handle_supply(inputs: Record<string, string>) {
		set_error(null);
		set_error_code(null);
		await run_busy('supply', async () => {
			const res = await auth_fetch('/v1/runs/supply_inputs', {
				method: 'POST',
				body: JSON.stringify({ run_id, inputs }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				set_error_code(api_error_code(data));
				return;
			}
			set_notice('Inputs supplied — run should resume.');
			set_show_supply(false);
			await load({ silent: true });
		});
	}

	async function handle_cancel() {
		set_error(null);
		set_error_code(null);
		await run_busy('cancel', async () => {
			const res = await auth_fetch('/v1/runs/cancel', {
				method: 'POST',
				body: JSON.stringify({ run_id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				set_error_code(api_error_code(data));
				return;
			}
			const cancel_payload = hub_payload<{ mode?: string }>(data);
			if (cancel_payload?.mode === 'hub_terminated') {
				set_notice(
					'Run marked cancelled on the Hub (daemon unreachable). If cliqd is still running the process, restart it to stop the work.',
				);
			} else if (cancel_payload?.mode === 'already_terminal') {
				set_notice('Run was already finished.');
			} else {
				set_notice('Cancel queued — waiting on the daemon to pick it up.');
			}
			set_show_cancel(false);
			await load({ silent: true });
		});
	}

	async function handle_resume(from_phase: string) {
		if (!from_phase.trim()) return;
		set_error(null);
		set_error_code(null);
		await run_busy('resume', async () => {
			const res = await auth_fetch('/v1/runs/resume', {
				method: 'POST',
				body: JSON.stringify({ run_id, from_phase }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				set_error_code(api_error_code(data));
				return;
			}
			// Same shape as cancel: this is a queued dispatch, not a
			// synchronous restart. The daemon picks it up via outbox
			// and re-runs from `from_phase` — the reload will flip
			// the run pill back to "running" once that happens.
			set_notice(`Resume queued from '${from_phase}' — waiting on the daemon to pick it up.`);
			set_show_resume(false);
			await load({ silent: true });
		});
	}

	// Adapts the flat phase-list rows into the shape DagPanel needs
	// (adds `phase_type` default + synthesises `depends_on` when the
	// backend omits it). Memoised so DagPanel's xyflow layout doesn't
	// re-run on every unrelated state change. Kept above the early
	// `if (loading)` return to preserve hook ordering across the
	// loading→loaded transition.
	const dag_phases = useMemo(() => normalize_phases_for_dag(phases), [phases]);

	if (loading) {
		return (
			<div className="flex min-h-[40vh] items-center justify-center">
				<p className="text-sm text-slate-400">Loading run…</p>
			</div>
		);
	}

	const title = run?.run_name || run_id;
	const awaiting = run?.state === 'awaiting_input';
	const failed = run?.state === 'failed' || run?.state === 'crashed';
	const completed = run?.state === 'completed';
	const daemon_href = run?.daemon_id
		? `${base_path}/daemons/${run.daemon_id}`
		: `${base_path}/daemons`;
	const inputs_obj = parse_inputs(run?.inputs);
	// "Run again" needs a well-formed team_id (scope/slug) to open the
	// prefilled dialog. When it's missing (older runs, orphan rows)
	// we hide the button rather than open a dialog that can't do
	// anything useful.
	const run_again_target = parse_team_id(run?.team_id);
	const pending = run?.pending_control ?? null;
	// A cancel is "in flight" until the daemon acks the command AND
	// the run's own state has moved out of running/awaiting_input.
	// We gate the button on the outbox row (not the run state) so
	// double-clicks don't enqueue a second command while the first
	// is still pending. Once the daemon terminates the run the state
	// leaves is_live and the button naturally disappears anyway.
	const cancel_pending = pending?.endpoint === '/v1/cancel';
	const supply_pending = pending?.endpoint === '/v1/runs/supply_inputs';
	// Resume dispatches route through /v1/runs/resume (from_phase), which
	// enqueues /v1/resume in the daemon outbox. Same "in flight"
	// treatment as cancel: gate the button on the pending row so we
	// don't queue duplicates while the first is still travelling.
	const resume_pending = pending?.endpoint === '/v1/resume';
	// Runs that are eligible to resume from a phase — failed, crashed,
	// or awaiting input. Completed runs don't get this — they use
	// "Run again" (slice 3.2). Live/running runs don't get it either;
	// cancel first.
	// AND: once the daemon has confirmed it lost the run's local
	// state (state_lost_at set), Resume is impossible on any daemon.
	// Hide the button and let the orphan banner offer Run again as
	// the only path forward.
	const state_lost = Boolean(run?.state_lost_at);
	const can_resume = (failed || awaiting) && !state_lost;

	return (
		<div className="flex h-full min-h-0 flex-col">
			{!run ? (
				<p className="mt-4 text-sm text-red-500">{error || 'Run not found'}</p>
			) : (
				<div className="flex min-h-0 flex-1 flex-col">
					{notice ? (
						<div className="mb-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
							<span>{notice}</span>
							<button type="button" onClick={() => set_notice(null)} className="font-bold">&times;</button>
						</div>
					) : null}

					{state_lost ? (
						<Orphaned_run_banner
							can_run_again={Boolean(run_again_target)}
							on_click_run_again={() => {
								set_show_supply(false);
								set_show_cancel(false);
								set_show_resume(false);
								set_show_run_again(true);
							}}
						/>
					) : run?.force_terminate?.already_terminated ? (
						<Force_terminated_banner status={run.force_terminate} />
					) : pending ? (
						<Pending_control_banner
							pending={pending}
							daemon_id={run?.daemon_id ?? null}
						/>
					) : null}

					<div className="mb-4 flex items-center justify-between gap-3">
						<h1 className="min-w-0 truncate text-xl font-semibold leading-none tracking-tight text-slate-900 sm:text-[22px]">
							{title}
						</h1>
						<div className="flex shrink-0 flex-wrap items-center gap-2">
							{awaiting ? (
								supply_pending ? (
									<button
										type="button"
										disabled
										aria-disabled
										title={pending?.last_error
											? `Waiting on daemon — ${pending.attempts}/${pending.max_attempts} attempts. Last error: ${pending.last_error}`
											: 'Waiting on daemon to acknowledge the supplied inputs.'}
										className="cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-400"
									>
										Unblock pending…
									</button>
								) : (
									<button
										type="button"
										onClick={() => {
											set_show_cancel(false);
											set_show_supply((v) => !v);
										}}
										className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600"
									>
										{show_supply ? 'Close' : 'Unblock'}
									</button>
								)
							) : null}
							{is_live ? (
								<>
									<Link
										to={`${base_path}/runs/${run_id}/live`}
										className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600"
									>
										<Radio className="h-3.5 w-3.5" />
										Watch live
									</Link>
									{cancel_pending ? (
										<button
											type="button"
											disabled
											aria-disabled
											title={pending?.last_error
												? `Waiting on daemon — ${pending.attempts}/${pending.max_attempts} attempts. Last error: ${pending.last_error}`
												: 'Waiting on daemon to acknowledge the cancel.'}
											className="cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-400"
										>
											Cancel pending…
										</button>
									) : (
										<button
											type="button"
											onClick={() => {
												set_show_supply(false);
												set_show_cancel((v) => !v);
											}}
											className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
										>
											Cancel
										</button>
									)}
								</>
							) : null}
							{can_resume ? (
								resume_pending ? (
									<button
										type="button"
										disabled
										title={pending?.attempts
											? `Waiting on daemon — ${pending.attempts}/${pending.max_attempts} attempts.${pending.last_error ? ` Last error: ${pending.last_error}` : ''}`
											: 'Waiting on daemon to pick up the resume command.'}
										className="cursor-not-allowed rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-400"
									>
										Resume pending…
									</button>
								) : (
									<button
										type="button"
										onClick={() => {
											set_show_supply(false);
											set_show_cancel(false);
											set_show_resume((v) => !v);
										}}
										className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
									>
										Resume from…
									</button>
								)
							) : null}
							{(failed || completed) && run_again_target ? (
								<button
									type="button"
									onClick={() => {
										set_show_supply(false);
										set_show_cancel(false);
										set_show_resume(false);
										set_show_run_again(true);
									}}
									title="Start a fresh run — inputs are copied from this run and can be tweaked before starting"
									className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
								>
									Run again
								</button>
							) : null}
						</div>
					</div>

					<ApiErrorBanner
						error={error}
						onDismiss={() => { set_error(null); set_error_code(null); }}
						action={
							// Only offer the shortcut when (a) the daemon-side
							// failure means the run really is unrecoverable
							// and (b) we have the team_id needed to prefill
							// the Run_in_realm_dialog. Otherwise fall back to
							// the plain banner — no dead-end buttons.
							error_code && _STRANDED_CODES.has(error_code) && run_again_target
								? {
									label: 'Run again',
									on_click: () => {
										set_error(null);
										set_error_code(null);
										set_show_run_again(true);
									},
								}
								: undefined
						}
					/>

					{show_supply ? (
						<div className="mt-4">
							<Supply_inputs_dialog
								run_id={run.run_id}
								submitting={is_busy('supply')}
								on_submit={(inputs) => void handle_supply(inputs)}
								on_cancel={() => set_show_supply(false)}
							/>
						</div>
					) : null}

					{show_cancel ? (
						<div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/50 p-4">
							<p className="mb-2 text-xs font-bold uppercase tracking-wider text-rose-700">Cancel run</p>
							<Confirm_action
								busy={is_busy('cancel')}
								busy_label="Cancelling…"
								confirm_label="Confirm cancel"
								on_confirm={() => void handle_cancel()}
								on_cancel={() => set_show_cancel(false)}
							/>
						</div>
					) : null}

					{show_resume ? (
						<div className="mt-4">
							<Resume_from_phase_dialog
								run_id={run.run_id}
								phases={phases}
								submitting={is_busy('resume')}
								on_submit={(from_phase) => void handle_resume(from_phase)}
								on_cancel={() => set_show_resume(false)}
							/>
						</div>
					) : null}

					{show_run_again && run_again_target ? (
						<Run_in_realm_dialog
							scope={run_again_target.scope}
							slug={run_again_target.slug}
							fixed_realm={{ id: realm.id, slug: realm.slug, name: realm.name }}
							prefill_from={{
								inputs: inputs_obj ?? {},
								run_name: run.run_name ? `${run.run_name} (rerun)` : null,
								source_run_id: run.run_id,
							}}
							on_close={() => {
								set_show_run_again(false);
								// Refresh in case the new run appeared on the runs list
								// or the realm's run counter changed.
								void load({ silent: true });
							}}
						/>
					) : null}

					{run.error ? (
						<div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-800">
							{run.error}
						</div>
					) : null}

					<div className="mt-4">
						<Run_phases_panel
							phases={phases}
							loading={loading}
							run_state={run.state}
							selected_phase={selected_phase}
							on_select_phase={set_selected_phase}
						/>
					</div>

					<div className="mt-4">
						<Run_summary_strip run_id={run.run_id} live={is_live} />
					</div>

					<div className="mt-4">
						<UsageBreakdownTable run_id={run.run_id} />
					</div>

					{/* Two-column layout: logs/timeline/dag (left, wider) · status (right sidebar) */}
					<div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-12">
						<div className="order-2 flex min-h-0 flex-col gap-2 lg:order-1 lg:col-span-8 xl:col-span-9 h-[600px]">
							<div
								role="tablist"
								aria-label="Run observability views"
								className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-xs font-semibold dark:border-slate-800 dark:bg-slate-900 w-fit"
							>
								{VALID_DETAIL_TABS.map((tab) => (
									<button
										key={tab}
										type="button"
										role="tab"
										aria-selected={detail_tab === tab}
										onClick={() => set_detail_tab(tab)}
										className={
											'rounded-md px-3 py-1.5 capitalize transition '
											+ (detail_tab === tab
												? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
												: 'text-slate-500 hover:text-slate-800 dark:text-slate-400')
										}
									>
										{tab === 'dag' ? 'DAG' : tab}
									</button>
								))}
							</div>
							<div className="min-h-0 flex-1 overflow-auto" role="tabpanel">
								{detail_tab === 'logs' ? (
									<Run_logs_section
										run_id={run.run_id}
										realm_id={realm.id}
										live={is_live}
										phases={phases}
										phase_filter={selected_phase ?? ''}
										on_phase_filter_change={(phase) => set_selected_phase(phase || null)}
									/>
								) : detail_tab === 'timeline' ? (
									<Run_timeline_panel run_id={run.run_id} live={is_live} />
								) : (
									<div className="h-full min-h-[520px] rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
										<DagPanel
											phases={dag_phases}
											selected_phase={selected_phase}
											on_phase_select={set_selected_phase}
										/>
									</div>
								)}
							</div>
						</div>

						<aside className="order-1 flex min-h-0 flex-col gap-4 overflow-auto lg:order-2 lg:col-span-4 xl:col-span-3">
							<section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
						<dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3">
							<div className="min-w-0 col-span-1">
								<dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
									Status
								</dt>
								<dd className="mt-1">
									<span
										className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${status_classes(run.state)}`}
									>
										{awaiting ? 'needs input' : run.state}
									</span>
								</dd>
							</div>
							<div className="min-w-0 max-w-full col-span-2">
								<dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
									Run ID
								</dt>
								<dd className="mt-1 flex items-center gap-1.5">
									<code
										className="select-all break-all font-mono text-xs text-slate-700"
										title={run.run_id}
									>
										{run.run_id}
									</code>
									<button
										type="button"
										onClick={copy_run_id}
										aria-label="Copy run id"
										title={copied_id ? 'Copied' : 'Copy run id'}
										className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
									>
										{copied_id ? (
											<CheckIcon className="h-3 w-3 text-emerald-600" />
										) : (
											<Copy className="h-3 w-3" />
										)}
									</button>
								</dd>
							</div>
							{team_label ? (
								<div className="min-w-0 col-span-1">
									<dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
										Team
									</dt>
									<dd
										className="mt-1 truncate font-mono text-xs text-slate-700"
										title={team_label}
									>
										{team_label}
									</dd>
								</div>
							) : null}
							<div className="min-w-0 col-span-2">
								<dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
									Workspace
								</dt>
								<dd className="mt-1 flex items-center gap-1.5">
									{workspace_name ? (
										<span
											className="text-xs text-slate-700"
											title={run.workspace_id ?? undefined}
										>
											{workspace_name}
										</span>
									) : run.workspace_id ? (
										<>
											<code
												className="select-all break-all font-mono text-xs text-slate-700"
												title={run.workspace_id}
											>
												{run.workspace_id}
											</code>
											<button
												type="button"
												onClick={copy_workspace_id}
												aria-label="Copy workspace id"
												title={copied_workspace ? 'Copied' : 'Copy workspace id'}
												className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
											>
												{copied_workspace ? (
													<CheckIcon className="h-3 w-3 text-emerald-600" />
												) : (
													<Copy className="h-3 w-3" />
												)}
											</button>
										</>
									) : (
										<span className="text-xs text-slate-400">—</span>
									)}
								</dd>
							</div>
							<div className="min-w-0 col-span-2">
								<dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
									Daemon
								</dt>
								<dd className="mt-1 flex items-center gap-1.5">
									{run.daemon_id ? (
										<>
											<Link
												to={daemon_href}
												className="select-all break-all font-mono text-xs font-semibold text-indigo-600 hover:underline"
												title={run.daemon_id}
											>
												{run.daemon_id}
											</Link>
											<button
												type="button"
												onClick={copy_daemon_id}
												aria-label="Copy daemon id"
												title={copied_daemon ? 'Copied' : 'Copy daemon id'}
												className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
											>
												{copied_daemon ? (
													<CheckIcon className="h-3 w-3 text-emerald-600" />
												) : (
													<Copy className="h-3 w-3" />
												)}
											</button>
										</>
									) : (
										<span className="text-xs text-slate-400">—</span>
									)}
								</dd>
							</div>
							{run.started_at ? (
								<div className="min-w-0 col-span-1">
									<dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
										Started
									</dt>
									<dd
										className="mt-1 text-xs text-slate-700"
										title={format_datetime(run.started_at)}
									>
										{format_relative(run.started_at)}
									</dd>
								</div>
							) : null}
							{run.completed_at ? (
								<div className="min-w-0 col-span-1">
									<dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
										Finished
									</dt>
									<dd
										className="mt-1 text-xs text-slate-700"
										title={format_datetime(run.completed_at)}
									>
										{format_relative(run.completed_at)}
									</dd>
								</div>
							) : is_live ? (
								<div className="min-w-0 col-span-1">
									<dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
										Finished
									</dt>
									<dd className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700">
										<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
										live
									</dd>
								</div>
							) : null}
							{run.external_id ? (
								<div className="min-w-0 col-span-2">
									<dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
										External ID
									</dt>
									<dd className="mt-1 flex items-center gap-1.5">
										{run.context_labels?.external_url ? (
											<a
												href={run.context_labels.external_url}
												target="_blank"
												rel="noopener noreferrer"
												className="inline-flex items-center gap-1 break-all rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
												title={run.external_id}
											>
												{run.external_id}
											</a>
										) : (
											<span
												className="inline-block break-all rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700"
												title={run.external_id}
											>
												{run.external_id}
											</span>
										)}
										<button
											type="button"
											onClick={copy_external_id}
											aria-label="Copy external id"
											title={copied_external ? 'Copied' : 'Copy external id'}
											className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
										>
											{copied_external ? (
												<CheckIcon className="h-3 w-3 text-emerald-600" />
											) : (
												<Copy className="h-3 w-3" />
											)}
										</button>
									</dd>
								</div>
							) : null}
						</dl>
						{(run.context_labels &&
							Object.keys(run.context_labels).filter((k) => k !== 'external_url').length > 0) ||
						inputs_obj ? (
							<details
								className="border-t border-slate-100 px-4 py-2"
								open={Boolean(inputs_obj)}
							>
								<summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600">
									{inputs_obj ? 'Inputs & labels' : 'Labels'}
								</summary>
								<div className="mt-3 grid gap-4 md:grid-cols-2">
									{run.context_labels &&
									Object.keys(run.context_labels).filter((k) => k !== 'external_url').length > 0 ? (
										<div>
											<h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
												Labels
											</h3>
											<dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
												{Object.entries(run.context_labels)
													.filter(([k]) => k !== 'external_url')
													.map(([k, v]) => (
														<div key={k} className="contents">
															<dt
																className="truncate font-mono text-[10px] text-slate-500"
																title={k}
															>
																{k}
															</dt>
															<dd
																className="min-w-0 truncate font-mono text-[11px] text-slate-800"
																title={String(v)}
															>
																{v}
															</dd>
														</div>
													))}
											</dl>
										</div>
									) : null}
									{inputs_obj ? (
										<div>
											<h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
												Inputs
											</h3>
											<pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-700">
												{JSON.stringify(inputs_obj, null, 2)}
											</pre>
										</div>
									) : null}
								</div>
							</details>
						) : null}
					</section>
						</aside>
					</div>
				</div>
			)}
		</div>
	);
}

/** Human label for a pending control endpoint. */
function _control_label(endpoint: string): string {
	if (endpoint === '/v1/cancel') return 'Cancel';
	if (endpoint === '/v1/runs/supply_inputs') return 'Supply inputs';
	if (endpoint === '/v1/resume') return 'Resume';
	if (endpoint === '/v1/execute') return 'Start';
	return endpoint;
}

/**
 * Persistent banner that surfaces the in-flight control command
 * (cancel / supply inputs) sitting in the daemon's command outbox.
 * Cancel itself escalates to Hub-side terminate when the daemon is
 * unreachable — no separate force-terminate control.
 */
function Pending_control_banner({
	pending,
	daemon_id,
}: {
	pending: Pending_control;
	daemon_id: string | null;
}) {
	const label = _control_label(pending.endpoint);
	const status = pending.delivered_at === null
		? 'queued — waiting for the Hub worker to pick it up'
		: 'delivered — waiting for the daemon to acknowledge';
	const attempts_line = pending.attempts > 0
		? `${pending.attempts}/${pending.max_attempts} delivery attempt${pending.attempts === 1 ? '' : 's'}`
		: 'no delivery attempts yet';
	const enqueued_ago = format_relative(pending.enqueued_at);
	return (
		<div
			role="status"
			aria-live="polite"
			data-testid="pending-control-banner"
			className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<p className="font-semibold">
						{label} pending on daemon{daemon_id ? ` ${daemon_id}` : ''}
					</p>
					<p className="mt-0.5 text-xs text-amber-800">
						{status} · {attempts_line} · queued {enqueued_ago}
					</p>
					{pending.last_error ? (
						<p className="mt-1 text-xs text-amber-800">
							<span className="font-semibold">Last error:</span>{' '}
							<span className="font-mono">{pending.last_error}</span>
						</p>
					) : null}
					{pending.attempts >= 3 && pending.delivered_at === null ? (
						<p className="mt-1 text-xs text-amber-800">
							The daemon isn't answering. Click Cancel again — Hub will mark
							the run cancelled if the daemon stays unreachable.
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
}

/**
 * Terminal banner shown when the daemon that owned this run's local
 * state came back to a dispatched command with `run_not_found`. Its
 * ephemeral storage was wiped on a pod restart — the phase records
 * and workspace tree are gone on every daemon in the realm.
 *
 * Takes precedence over the pending-control and hub-cancelled
 * banners because it's the strongest signal about the run's future:
 * no dispatched command (resume, cancel, supply_inputs) can succeed
 * against this run anymore. Run again is the only path.
 */
function Orphaned_run_banner({
	can_run_again,
	on_click_run_again,
}: {
	can_run_again: boolean;
	on_click_run_again: () => void;
}) {
	return (
		<div
			role="alert"
			data-testid="orphaned-run-banner"
			className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<p className="font-semibold">
						Daemon lost this run's local state
					</p>
					<p className="mt-0.5 text-xs text-rose-800">
						The daemon that owned this run restarted and its
						ephemeral storage was wiped. Phase records and
						workspace files are no longer available on any
						daemon — Resume can't recover them. Start a fresh
						run with the same inputs to move forward.
					</p>
				</div>
				{can_run_again ? (
					<button
						type="button"
						onClick={on_click_run_again}
						className="shrink-0 rounded-md border border-rose-400 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm hover:bg-rose-100"
					>
						Run again
					</button>
				) : null}
			</div>
		</div>
	);
}

/**
 * Terminal banner when Cancel escalated to a Hub-side mark because the
 * daemon was unresponsive.
 */
function Force_terminated_banner({ status }: { status: Force_terminate_status }) {
	return (
		<div
			role="status"
			data-testid="force-terminated-banner"
			className="mb-4 rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-800"
		>
			<p className="font-semibold">
				Cancelled on the Hub{status.terminated_by_user_id ? ` by user ${status.terminated_by_user_id}` : ''}
				{status.terminated_at ? ` · ${format_relative(status.terminated_at)}` : ''}
			</p>
			<p className="mt-0.5 text-xs text-slate-600">
				This run was marked cancelled at the Hub level because the daemon
				was unresponsive. The daemon may still have been executing this
				work when the mark was applied; restart cliqd if you need to be
				certain the process is stopped.
			</p>
			{status.terminated_reason ? (
				<p className="mt-1 text-xs text-slate-600">
					<span className="font-semibold">Reason:</span> {status.terminated_reason}
				</p>
			) : null}
		</div>
	);
}
