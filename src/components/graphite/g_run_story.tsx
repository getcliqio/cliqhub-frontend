/**
 * The run, phase by phase (PLAN-run-page S2–S6) — the run page's default view.
 *
 * One line per phase, in order: its state, its name, what it does (S1), "sent back n×", time, cost.
 * Runs of finished phases fold into one line. Only a phase that needs something opens by itself
 * (waiting on someone, failed, running); any other opens on click. An open phase shows its own story:
 * the Hug it asks (answered right there for an approval, S4), why it failed (S5), its tries and why each
 * was sent back, what it produced (S3), its sub-team runs. "Full output", "What happened", "Logs" and
 * "About" open the side panel (S6).
 *
 * Nothing here is written by the page: reasons are the gates' own words, outputs are the stored ones,
 * and the fixed sentences only fill in names and counts from the run's events.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuthFetch } from '@/lib/auth_context';
import { hug_href, respond, type Hug_page_data } from '@/lib/hug';
import { relative_time } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { phase_state_in_run } from '@/lib/phase_state';
import { phase_purpose } from '@/lib/phase_purpose';
import {
	format_duration, is_live_state,
	type Run_artifact, type Run_child, type Run_detail_phase, type Run_failure, type Run_hug_round,
	type Run_phase_def, type Run_phase_output, type Run_route_back, type Section_status,
} from '@/lib/realm_inbox';
import { fmt_usd, type Run_telemetry_data, type Telemetry_phase } from '@/lib/run_telemetry';
import { State_dot, State_pill } from '@/components/graphite/g_status';
import { G_phase_output } from '@/components/graphite/g_phase_output';
import { G_run_artifacts } from '@/components/graphite/g_run_artifacts';
import { G_run_logs } from '@/components/graphite/g_run_logs';
import { Run_failure_card } from '@/components/graphite/g_run_failure';
import { Sub_team_tree, type Tree_step } from '@/components/graphite/g_sub_team_tree';

/** What the side panel shows for a phase. */
export type Panel_tab = 'what' | 'output' | 'logs' | 'about';
export interface Inspect { phase: string; tab: Panel_tab }

const DONE = new Set(['completed', 'done', 'skipped', 'passed']);
const FAILED = new Set(['failed', 'crashed']);
const WAITING = new Set(['awaiting_input', 'waiting', 'pending_input']);
/** Finished phases in a row fold into one line from this many on. */
const FOLD_MIN = 4;

const SMALL_BTN = 'inline-flex h-7 items-center rounded-md border border-[var(--g-line)] px-2.5 text-[12px] font-semibold hover:bg-[var(--g-soft)] disabled:cursor-not-allowed disabled:opacity-45';
const SMALL_PRIMARY = 'inline-flex h-7 items-center rounded-md bg-[var(--g-acc)] px-2.5 text-[12px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:cursor-not-allowed disabled:opacity-45';
const LBL = 'mb-1 mt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)] first:mt-0';

/** A phase's route-backs: the times a gate sent it back (qualified names inside sub-teams match on the last part). */
export function route_backs_of(all: Run_route_back[] | null | undefined, phase: string): Run_route_back[] {
	return (all ?? []).filter((r) => r.phase === phase || (r.phase ?? '').endsWith(`.${phase}`));
}

/** The route-backs a gate made (its verdicts that sent work back). */
export function route_backs_by(all: Run_route_back[] | null | undefined, gate: string): Run_route_back[] {
	return (all ?? []).filter((r) => r.routed_by === gate || r.routed_by.endsWith(`.${gate}`));
}

/** The phases to show open by themselves: waiting on someone, failed, running. */
export function auto_open(phases: Run_detail_phase[], run_state: string): Set<string> {
	const out = new Set<string>();
	for (const p of phases) {
		const s = phase_state_in_run(p.status, run_state);
		if (WAITING.has(s) || FAILED.has(s) || s === 'running') out.add(p.phase);
	}
	return out;
}

/** Rows to draw: phases, with stretches of finished phases folded (never one that is open). */
export type Story_item = { kind: 'phase'; phase: Run_detail_phase } | { kind: 'fold'; key: string; phases: Run_detail_phase[] };
export function fold_phases(phases: Run_detail_phase[], run_state: string, keep_open: Set<string>): Story_item[] {
	const out: Story_item[] = [];
	let run: Run_detail_phase[] = [];
	const flush = () => {
		if (run.length >= FOLD_MIN) out.push({ kind: 'fold', key: `fold:${run[0].phase}`, phases: run });
		else for (const p of run) out.push({ kind: 'phase', phase: p });
		run = [];
	};
	for (const p of phases) {
		const s = phase_state_in_run(p.status, run_state);
		if (DONE.has(s) && !keep_open.has(p.phase)) run.push(p);
		else { flush(); out.push({ kind: 'phase', phase: p }); }
	}
	flush();
	return out;
}

function first_line(s: string, max = 220): { line: string; more: boolean } {
	const line = s.split('\n').find((l) => l.trim())?.trim() ?? '';
	return line.length > max ? { line: `${line.slice(0, max)}…`, more: true } : { line, more: s.trim() !== line };
}

/* ------------------------------------------------------------------ */
/* S4 — answering a phase's Hug from the run page                      */

/** The open Hug of a waiting phase: an approval answered here; any other hug opens on its own page. */
export function Hug_box({ hug_id, title, on_answered }: { hug_id: string; title: string; on_answered: () => void }) {
	const auth_fetch = useAuthFetch();
	const read = use_bff_read<Hug_page_data>('/v1/hug_page/get', { hug_id }, { fallback_error: 'Could not load this Hug.' });
	const [note, set_note] = useState('');
	const [choice, set_choice] = useState<string>('');
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	const hug = read.data?.hug ?? null;
	const params = (hug?.params ?? {}) as { reject_choices?: Array<{ value: string; label?: string }>; inputs?: unknown; approve_label?: string; reject_label?: string };
	const choices = params.reject_choices ?? [];
	const has_inputs = Array.isArray(params.inputs) ? params.inputs.length > 0 : Boolean(params.inputs && typeof params.inputs === 'object' && Object.keys(params.inputs as object).length);
	const is_approval = hug?.hug?.name === 'approval' || (hug && !hug.hug && !has_inputs && choices.length > 0);
	const can_answer = hug ? hug.status === 'open' && hug.viewer?.can_answer !== false : false;
	const inline = Boolean(hug && is_approval && !has_inputs && can_answer);
	const answered_by_me = hug?.viewer && !hug.viewer.can_answer && hug.status === 'open';

	async function send(values: Record<string, unknown>, needs_note: boolean) {
		if (needs_note && !note.trim()) { set_err('Write what should change first.'); return; }
		set_err(null);
		set_busy(true);
		const r = await respond(auth_fetch, hug_id, values);
		set_busy(false);
		if (!r.ok) { set_err(r.message); return; }
		set_note('');
		on_answered();
	}

	return (
		<div className="rounded-[10px] border border-[var(--g-warn-line)] bg-[rgba(255,178,36,.05)] px-3.5 py-3" data-testid="hug-box">
			<p className="text-[13.5px] font-semibold">{hug?.title ?? title}</p>
			{hug?.summary ? <p className="mt-0.5 text-[12.5px] text-[var(--g-ink-2)]">{hug.summary}</p> : null}
			{hug ? (
				<p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">
					{hug.responses.length} answer{hug.responses.length === 1 ? '' : 's'} so far{hug.expires_at ? ` · expires ${relative_time(Date.parse(hug.expires_at))}` : ''}
					{answered_by_me ? ' · you can’t answer this one' : ''}
				</p>
			) : read.status === 'error' ? <p className="mt-0.5 text-[12px] text-[var(--g-warn-text)]">{read.error}</p> : null}
			{inline ? (
				<div className="mt-2.5 flex flex-wrap items-center gap-2">
					<input
						value={note}
						onChange={(e) => { set_note(e.target.value); if (err) set_err(null); }}
						placeholder={choices.length ? 'What should change (needed to send back or reject)' : 'Note (needed to reject)'}
						aria-label="Note"
						className="min-w-[220px] flex-1 rounded-md border border-[var(--g-line-strong)] bg-[var(--g-input)] px-2.5 py-1.5 text-[12.5px] text-[var(--g-ink)]"
					/>
					{choices.length ? (
						<>
							{choices.length > 1 ? (
								<select value={choice || choices[0].value} onChange={(e) => set_choice(e.target.value)} aria-label="Send back to" className="rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2 py-1 text-[12px]">
									{choices.map((c) => <option key={c.value} value={c.value}>{c.label ?? `Send back to ${c.value}`}</option>)}
								</select>
							) : null}
							<button type="button" disabled={busy} className={SMALL_BTN} onClick={() => void send({ decision: 'reject', reason: note.trim(), choice: choice || choices[0].value }, true)}>
								{choices.length === 1 ? (choices[0].label ?? `Send back to ${choices[0].value}`) : 'Send back'}
							</button>
						</>
					) : (
						<button type="button" disabled={busy} className={SMALL_BTN} onClick={() => void send({ decision: 'reject', reason: note.trim() }, true)}>{params.reject_label ?? 'Reject'}</button>
					)}
					<button type="button" disabled={busy} className={SMALL_PRIMARY} onClick={() => void send({ decision: 'approve', comment: note.trim() || null }, false)}>{params.approve_label ?? 'Approve'}</button>
				</div>
			) : null}
			{err ? <p role="alert" className="mt-1.5 text-[12px] text-[var(--g-bad-text)]">{err}</p> : null}
			<p className="mt-2 text-[12px]">
				<Link to={hug_href(hug_id)} className="text-[var(--g-acc)] hover:underline" data-testid="hug-open">{inline ? 'Open the Hug' : can_answer ? 'Answer on the Hug page' : 'Open the Hug'} ↗</Link>
			</p>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* S5 — a failed phase                                                 */

/** How a failed phase stopped, as a short head, from what the run recorded (no wording of the page's own). */
export function stop_head(p: Run_detail_phase, def: Run_phase_def | undefined, routed: Run_route_back[], run_state: string): string {
	const s = phase_state_in_run(p.status, run_state);
	const max = def?.max_iterations ?? routed[routed.length - 1]?.max_iterations ?? null;
	if ((def?.type === 'gate' || routed.length) && max && routed.length + 1 >= max) return `Still failing after ${max} tries`;
	if (s === 'crashed') return 'Crashed';
	if (/timed? ?out/i.test(p.error ?? '')) return 'Timed out';
	if (/escalat/i.test(p.error ?? '')) return 'Escalated';
	return 'Failed';
}

function Fail_box({ p, def, routed, run_state, rerun_from, on_rerun, on_inspect }: {
	p: Run_detail_phase; def: Run_phase_def | undefined; routed: Run_route_back[]; run_state: string;
	rerun_from: string | null; on_rerun: ((phase: string) => void) | null; on_inspect: (tab: Panel_tab) => void;
}) {
	const [more, set_more] = useState(false);
	const why = p.error ?? routed[routed.length - 1]?.reason ?? null;
	const fl = why ? first_line(why) : null;
	return (
		<div className="rounded-[10px] border border-[var(--g-bad-line)] bg-[rgba(255,92,92,.05)] px-3.5 py-3" data-testid="fail-box">
			<p className="text-[13.5px] font-semibold">{stop_head(p, def, routed, run_state)}</p>
			{fl ? (
				<p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] text-[var(--g-ink-2)]" data-testid="fail-reason">
					{more ? why : fl.line}
					{fl.more ? <button type="button" onClick={() => set_more((m) => !m)} className="ml-1.5 text-[12px] text-[var(--g-acc)] hover:underline">{more ? 'less' : 'more'}</button> : null}
				</p>
			) : <p className="mt-0.5 text-[12.5px] text-[var(--g-ink-3)]">The phase reported no reason; the logs have what it printed.</p>}
			<div className="mt-2.5 flex flex-wrap gap-2">
				{on_rerun && rerun_from ? <button type="button" className={SMALL_PRIMARY} onClick={() => on_rerun(rerun_from)}>Resume from {rerun_from}</button> : null}
				<button type="button" className={SMALL_BTN} onClick={() => on_inspect('what')}>What happened</button>
				<button type="button" className={SMALL_BTN} onClick={() => on_inspect('logs')}>Logs</button>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* One phase                                                           */

export interface Story_props {
	phases: Run_detail_phase[];
	defs: Map<string, Run_phase_def>;
	run_state: string;
	telemetry: Run_telemetry_data | null;
	outputs: Map<string, Run_phase_output[]>;
	handoffs: Map<string, Run_artifact[]>;
	artifacts: Run_artifact[];
	artifacts_status: Section_status | undefined;
	children: Map<string, Run_child[]>;
	child_link: (c: Run_child) => string;
	run_link: (run_id: string) => string;
	rounds: Map<string, Run_hug_round[]>;
	route_backs: Run_route_back[];
	/** The run's open Hugs. */
	hugs: Array<{ id: string; title: string; phase: string | null }>;
	failure: Run_failure | null;
	/** Which phase to resume from when one fails (Core's resume point, else the gate's route target, else the phase). */
	on_rerun: ((phase: string) => void) | null;
	on_inspect: (i: Inspect) => void;
	inspecting: string | null;
	on_answered: () => void;
	resumed: boolean;
	tree: { open: Set<string>; toggle: (run_id: string) => void; selected: { run_id: string; phase: string } | null; on_select: (s: Tree_step) => void; run_href: (run_id: string) => string };
}

function rerun_point(p: Run_detail_phase, def: Run_phase_def | undefined, failure: Run_failure | null): string {
	if (failure?.resume_from && failure.chain[0]?.phase === p.phase) return failure.resume_from;
	return def?.route_targets[0] ?? failure?.resume_from ?? p.phase;
}

function Phase_body({ p, s, ...x }: Story_props & { p: Run_detail_phase; s: string }) {
	const def = x.defs.get(p.phase);
	const mine = x.outputs.get(p.phase) ?? [];
	const latest = mine[mine.length - 1];
	const routed_here = route_backs_of(x.route_backs, p.phase);
	const routed_by_me = route_backs_by(x.route_backs, p.phase);
	const own_artifacts = x.artifacts.filter((a) => a.phase === p.phase && a.kind !== 'output' && a.kind !== 'phase_output' && a.kind !== 'handoff');
	const open_hug = WAITING.has(s) ? x.hugs.find((h) => h.phase === p.phase) : undefined;
	const rounds = x.rounds.get(p.phase) ?? [];
	const kids = x.children.get(p.phase) ?? [];
	const tel_sub = x.telemetry?.phases.find((t) => t.name === p.phase)?.sub_runs ?? [];
	const earlier = p.previous_attempts ?? [];
	const inspect = (tab: Panel_tab) => x.on_inspect({ phase: p.phase, tab });
	const succeeded_later = FAILED.has(s) && (x.run_state === 'failed' || x.run_state === 'crashed') ? [...kids].reverse().find((c) => c.state === 'completed') : undefined;
	return (
		<div className="flex cursor-default flex-col gap-2.5 pb-3 pl-[34px] pr-1 pt-1" onClick={(e) => e.stopPropagation()} data-testid="phase-open">
			{open_hug ? <Hug_box hug_id={open_hug.id} title={open_hug.title} on_answered={x.on_answered} /> : null}
			{FAILED.has(s) ? <Fail_box p={p} def={def} routed={routed_by_me.length ? routed_by_me : routed_here} run_state={x.run_state} rerun_from={rerun_point(p, def, x.failure)} on_rerun={x.on_rerun} on_inspect={inspect} /> : null}
			{s === 'running' ? (
				<p className="text-[12.5px] text-[var(--g-run-text)]">Working · started {relative_time(p.started_at)} · <button type="button" onClick={() => inspect('logs')} className="text-[var(--g-acc)] hover:underline">live logs</button></p>
			) : null}
			{succeeded_later ? (
				<p role="note" className="rounded-md border border-[var(--g-warn-line)] bg-[var(--g-warn-soft)] px-2.5 py-1.5 text-[12px]" data-testid="child-succeeded-later">
					Sub-team run <Link to={x.child_link(succeeded_later)} className="g-mono hover:underline">{succeeded_later.run_name || succeeded_later.run_id}</Link> succeeded later, but this run is still {x.run_state}.
					{x.on_rerun ? <button type="button" onClick={() => x.on_rerun!(p.phase)} className="ml-2 font-semibold text-[var(--g-acc)] hover:underline">Resume from {p.phase}</button> : null}
				</p>
			) : null}
			{routed_here.length || earlier.length ? (
				<div data-testid="phase-tries">
					<p className={LBL}>Tries</p>
					<ol className="flex flex-col gap-1 text-[12.5px]">
						{routed_here.map((r, i) => (
							<li key={`r${i}`} className="flex gap-2">
								<span className="g-mono w-[44px] shrink-0 text-[11.5px] text-[var(--g-ink-3)]" title={new Date(r.at).toLocaleString()}>{relative_time(r.at)}</span>
								<span className="min-w-0">
									Try {(r.iteration ?? i + 1)} sent back by <span className="g-mono">{r.routed_by}</span>
									{r.reason ? <span className="block whitespace-pre-wrap break-words text-[var(--g-warn-text)]">“{first_line(r.reason, 400).line}”</span> : null}
								</span>
							</li>
						))}
						{!routed_here.length && earlier.map((a, k) => (
							<li key={`e${k}`} className="flex items-center gap-2 text-[var(--g-ink-2)]" title={a.error ?? undefined}>
								<State_dot state={a.status} /> earlier try · {a.status}{a.completed_at || a.started_at ? <span className="text-[var(--g-ink-3)]"> · {relative_time(a.completed_at ?? a.started_at)}</span> : null}
							</li>
						))}
					</ol>
				</div>
			) : null}
			{routed_by_me.length && !FAILED.has(s) ? (
				<div>
					<p className={LBL}>Sent back</p>
					<ol className="flex flex-col gap-1 text-[12.5px]">
						{routed_by_me.map((r, i) => (
							<li key={i}>Check {(r.iteration ?? i + 1)}: sent <span className="g-mono">{r.phase}</span> back{r.reason ? <span className="text-[var(--g-warn-text)]"> — “{first_line(r.reason, 300).line}”</span> : null}</li>
						))}
					</ol>
				</div>
			) : null}
			{rounds.length && !open_hug ? (
				<div data-testid="phase-rounds">
					<p className={LBL}>{rounds.length > 1 ? 'Asked people' : 'Answer'}</p>
					<ul className="flex flex-col gap-0.5 text-[12.5px]">
						{rounds.map((r) => (
							<li key={r.id} className="flex flex-wrap items-center gap-1.5">
								<span>{rounds.length > 1 ? `Round ${r.round} · ` : ''}{r.outcome ?? (r.status === 'open' ? 'waiting' : r.status)}</span>
								{r.closed_at ? <span className="text-[var(--g-ink-3)]">· {relative_time(r.closed_at)}</span> : null}
								<Link to={hug_href(r.id)} className="text-[var(--g-acc)] hover:underline">{rounds.length > 1 ? `round ${r.round}` : 'Open the Hug'}</Link>
							</li>
						))}
					</ul>
				</div>
			) : null}
			{latest ? (
				<div>
					<p className={LBL}>What it produced</p>
					<G_phase_output outputs={mine} handoffs={x.handoffs.get(p.phase)} run_link={x.run_link} />
				</div>
			) : null}
			{own_artifacts.length ? (
				<div>
					<p className={LBL}>Files</p>
					<G_run_artifacts artifacts={own_artifacts} status={x.artifacts_status} embedded />
				</div>
			) : null}
			{tel_sub.length ? (
				<Sub_team_tree subs={tel_sub} open={x.tree.open} toggle={x.tree.toggle} selected={x.tree.selected} on_select={x.tree.on_select} run_href={x.tree.run_href} now={Date.now()} />
			) : kids.length ? (
				<ul className="flex flex-col gap-0.5 text-[12px]" aria-label={`Sub-team runs of ${p.phase}`}>
					{kids.map((c) => (
						<li key={c.run_id} className="flex min-w-0 items-center gap-1.5" data-testid="phase-child-run">
							<span className="text-[var(--g-ink-3)]">sub-team</span>
							<State_dot state={c.state} pulse={is_live_state(c.state)} />
							<Link to={x.child_link(c)} className="g-mono min-w-0 truncate hover:underline">{c.run_name || c.team_label || c.run_id}</Link>
							<State_pill state={c.state} />
						</li>
					))}
				</ul>
			) : null}
			{!latest && !own_artifacts.length && !open_hug && !FAILED.has(s) && s !== 'running' && !rounds.length && !kids.length && !tel_sub.length && !routed_here.length ? (
				<p className="text-[12.5px] text-[var(--g-ink-3)]">{s === 'pending' || s === 'not_started' ? 'Hasn’t run yet.' : 'No output was recorded for this phase.'}</p>
			) : null}
			<p className="flex flex-wrap gap-3 text-[12px]">
				{latest ? <button type="button" onClick={() => inspect('output')} className="text-[var(--g-acc)] hover:underline">Full output</button> : null}
				<button type="button" onClick={() => inspect('logs')} className="text-[var(--g-acc)] hover:underline">Logs</button>
				<button type="button" onClick={() => inspect('about')} className="text-[var(--g-acc)] hover:underline">About this phase</button>
			</p>
		</div>
	);
}

function phase_time(p: Run_detail_phase, s: string): string {
	if (WAITING.has(s) && p.started_at) return `waiting ${format_duration(Date.now() - p.started_at)}`;
	if (!p.started_at) return '';
	return format_duration((p.completed_at ?? Date.now()) - p.started_at);
}

function Phase_line({ p, s, open, toggle, x }: { p: Run_detail_phase; s: string; open: boolean; toggle: () => void; x: Story_props }) {
	const def = x.defs.get(p.phase);
	const purpose = phase_purpose(def, p.agent);
	const tel: Telemetry_phase | undefined = x.telemetry?.phases.find((t) => t.name === p.phase);
	const sent_back = route_backs_of(x.route_backs, p.phase).length || Math.max(0, (p.attempts ?? 1) - 1);
	const dim = s === 'pending' || s === 'not_started';
	const tone = FAILED.has(s) ? 'border-[var(--g-bad-line)]' : WAITING.has(s) ? 'border-[var(--g-warn-line)]' : 'border-transparent';
	return (
		<li className={`rounded-[8px] border ${open ? tone : 'border-transparent'} ${x.inspecting === p.phase ? 'bg-[var(--g-soft)]' : ''}`} data-phase-row={p.phase} data-testid="phase-row">
			<button
				type="button"
				onClick={toggle}
				aria-expanded={open}
				aria-label={`${open ? 'Close' : 'Open'} ${p.phase}`}
				className={`grid w-full grid-cols-[12px_14px_minmax(0,auto)_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[8px] px-2 py-2 text-left hover:bg-[var(--g-soft)] ${dim ? 'opacity-55' : ''}`}
			>
				<span aria-hidden className="text-[10px] text-[var(--g-ink-4)]">{open ? '▾' : '▸'}</span>
				<State_dot state={s} pulse={s === 'running'} />
				<span className="g-mono truncate text-[13px] font-semibold">{p.phase}</span>
				<span className="truncate text-[12.5px] text-[var(--g-ink-3)]" title={purpose.derived ? 'Worked out from the team’s definition (the team gives no description)' : 'The team’s description'} data-testid="phase-purpose">
					{purpose.text}
				</span>
				<span className="flex items-center gap-2.5 whitespace-nowrap">
					{WAITING.has(s) ? <State_pill state={s} /> : null}
					{sent_back ? <span className="text-[11.5px] text-[var(--g-warn-text)]" data-testid="phase-sent-back">sent back {sent_back}×</span> : null}
					{(x.rounds.get(p.phase)?.length ?? 0) > 1 ? <span className="text-[11.5px] text-[var(--g-ink-3)]">{x.rounds.get(p.phase)!.length} rounds</span> : null}
					<span className="g-mono text-[11.5px] text-[var(--g-ink-3)]">{phase_time(p, s)}</span>
					{x.telemetry ? <span className="g-mono w-[48px] text-right text-[11.5px] text-[var(--g-ink-2)]" data-testid="phase-cost">{fmt_usd(tel?.cost_usd ?? null)}</span> : null}
				</span>
			</button>
			{open ? <Phase_body {...x} p={p} s={s} /> : null}
		</li>
	);
}

/** The run, phase by phase. */
export function Run_story(x: Story_props) {
	const auto = useMemo(() => auto_open(x.phases, x.run_state), [x.phases, x.run_state]);
	// What the viewer toggled; until then, the phases that need something are open.
	const [toggled, set_toggled] = useState<Map<string, boolean>>(() => new Map());
	const is_open = (name: string) => toggled.get(name) ?? auto.has(name);
	const toggle = (name: string) => set_toggled((m) => new Map(m).set(name, !is_open(name)));
	const open_set = useMemo(() => new Set(x.phases.filter((p) => is_open(p.phase)).map((p) => p.phase)), [x.phases, toggled, auto]); // eslint-disable-line react-hooks/exhaustive-deps
	const items = useMemo(() => fold_phases(x.phases, x.run_state, open_set), [x.phases, x.run_state, open_set]);

	if (x.phases.length === 0) {
		return <p className="px-4 py-8 text-center text-[13px] text-[var(--g-ink-3)]">No phases recorded yet{is_live_state(x.run_state) ? ' — the daemon hasn’t reported any progress.' : '.'}</p>;
	}
	const line = (p: Run_detail_phase) => {
		const s = phase_state_in_run(p.status, x.run_state);
		return <Phase_line key={p.phase} p={p} s={s} open={is_open(p.phase)} toggle={() => toggle(p.phase)} x={x} />;
	};
	return (
		<ol className="flex flex-col gap-0.5 px-2 py-2" aria-label="Phases">
			{x.artifacts_status?.status === 'error' ? (
				<li role="status" className="px-2 pb-2 text-[12.5px] text-[var(--g-warn-text)]" data-testid="artifacts-error">Couldn’t load artifacts{x.artifacts_status.error ? `: ${x.artifacts_status.error}` : ''}.</li>
			) : null}
			{items.map((it) => {
				if (it.kind === 'phase') return line(it.phase);
				const open = toggled.get(it.key) ?? false;
				const total = it.phases.reduce((n, p) => n + (p.started_at ? (p.completed_at ?? p.started_at) - p.started_at : 0), 0);
				return (
					<li key={it.key} data-testid="phase-fold">
						<button type="button" aria-expanded={open} onClick={() => set_toggled((m) => new Map(m).set(it.key, !open))} className="grid w-full grid-cols-[12px_14px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[8px] px-2 py-2 text-left text-[12.5px] text-[var(--g-ink-3)] hover:bg-[var(--g-soft)]">
							<span aria-hidden className="text-[10px] text-[var(--g-ink-4)]">{open ? '▾' : '▸'}</span>
							<State_dot state="completed" />
							<span className="truncate">{it.phases.length} phases done · {it.phases.slice(0, 3).map((p) => p.phase).join(', ')}{it.phases.length > 3 ? '…' : ''}</span>
							<span className="g-mono text-[11.5px]">{total ? format_duration(total) : ''}</span>
						</button>
						{open ? <ol className="ml-4 flex flex-col gap-0.5 border-l border-[var(--g-line)] pl-1">{it.phases.map(line)}</ol> : null}
					</li>
				);
			})}
		</ol>
	);
}

/* ------------------------------------------------------------------ */
/* S6 — the side panel                                                 */

export function Phase_panel({ inspect, set_tab, on_close, x, realm_id, run_id, live }: {
	inspect: Inspect; set_tab: (t: Panel_tab) => void; on_close: () => void; x: Story_props;
	realm_id: string | null; run_id: string; live: boolean;
}) {
	const p = x.phases.find((q) => q.phase === inspect.phase);
	if (!p) return null;
	const s = phase_state_in_run(p.status, x.run_state);
	const def = x.defs.get(p.phase);
	const purpose = phase_purpose(def, p.agent);
	const mine = x.outputs.get(p.phase) ?? [];
	const own_artifacts = x.artifacts.filter((a) => a.phase === p.phase && a.kind !== 'output' && a.kind !== 'phase_output' && a.kind !== 'handoff');
	const tabs: Array<[Panel_tab, string]> = [...(FAILED.has(s) ? [['what', 'What happened'] as [Panel_tab, string]] : []), ['output', 'Output'], ['logs', 'Logs'], ['about', 'About']];
	const tab = tabs.some(([t]) => t === inspect.tab) ? inspect.tab : tabs[0][0];
	const routed = route_backs_by(x.route_backs, p.phase).length ? route_backs_by(x.route_backs, p.phase) : route_backs_of(x.route_backs, p.phase);
	const finished_before = x.phases.filter((q) => DONE.has(phase_state_in_run(q.status, x.run_state))).length;
	const resume_at = rerun_point(p, def, x.failure);
	return (
		<aside className="flex min-h-0 flex-col rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-label={`Phase ${p.phase}`} data-testid="phase-panel">
			<div className="border-b border-[var(--g-line)] px-4 pt-3">
				<div className="flex items-center gap-2">
					<State_dot state={s} pulse={s === 'running'} />
					<h3 className="g-mono min-w-0 flex-1 truncate text-[13.5px] font-semibold">{p.phase}</h3>
					<button type="button" onClick={on_close} aria-label="Close panel" className="text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">✕</button>
				</div>
				<p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">{purpose.text}</p>
				<div role="tablist" aria-label="Phase views" className="mt-2 flex gap-4 text-[12.5px]">
					{tabs.map(([t, label]) => (
						<button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => set_tab(t)} className={`pb-1.5 ${tab === t ? 'font-semibold text-[var(--g-ink)] shadow-[inset_0_-2px_0_var(--g-acc)]' : 'text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>{label}</button>
					))}
				</div>
			</div>
			<div role="tabpanel" className="min-h-0 flex-1 overflow-auto px-4 py-3 text-[12.5px]">
				{tab === 'what' ? (
					<div className="flex flex-col gap-1" data-testid="what-happened">
						<p className={LBL}>Why it stopped</p>
						<p>{stop_head(p, def, routed, x.run_state)}{p.error ? <span className="mt-1 block whitespace-pre-wrap break-words text-[var(--g-ink-2)]">{p.error}</span> : null}</p>
						{routed.length ? (
							<>
								<p className={LBL}>Each try</p>
								<ol className="flex flex-col gap-1">
									{routed.map((r, i) => <li key={i}>{r.iteration ?? i + 1} · {r.reason ?? <span className="text-[var(--g-ink-3)]">no reason given</span>}</li>)}
								</ol>
							</>
						) : null}
						{x.failure && x.failure.chain[0]?.phase === p.phase ? (
							<>
								<p className={LBL}>Why the run failed</p>
								<Run_failure_card failure={x.failure} run_href={x.run_link} can_run={Boolean(x.on_rerun)} on_resume={x.on_rerun ?? undefined} />
							</>
						) : null}
						{mine.length ? (
							<>
								<p className={LBL}>Its last output</p>
								<G_phase_output outputs={mine} handoffs={x.handoffs.get(p.phase)} run_link={x.run_link} />
							</>
						) : null}
						<p className={LBL}>Resume</p>
						<p>Starts again at <span className="g-mono">{resume_at}</span> and keeps the {finished_before} finished phase{finished_before === 1 ? '' : 's'} before it.</p>
						{x.on_rerun ? <div className="mt-1"><button type="button" className={SMALL_PRIMARY} onClick={() => x.on_rerun!(resume_at)}>Resume from {resume_at}</button></div> : null}
					</div>
				) : tab === 'output' ? (
					mine.length || own_artifacts.length ? (
						<div className="flex flex-col gap-3">
							{mine.length ? <G_phase_output outputs={mine} handoffs={x.handoffs.get(p.phase)} run_link={x.run_link} /> : null}
							{own_artifacts.length ? <div><p className={LBL}>Files</p><G_run_artifacts artifacts={own_artifacts} status={x.artifacts_status} embedded /></div> : null}
						</div>
					) : <p className="text-[var(--g-ink-3)]">No output was recorded for this phase.</p>
				) : tab === 'logs' ? (
					realm_id ? (
						<div className="h-[520px]">
							<p className="mb-2 text-[11.5px] text-[var(--g-ink-3)]">The run’s log, searched for <span className="g-mono">{p.phase}</span> (log lines aren’t stored per phase).</p>
							<G_run_logs key={p.phase} run_id={run_id} realm_id={realm_id} live={live} initial_query={p.phase} />
						</div>
					) : <p className="text-[var(--g-ink-3)]">Logs are unavailable because this run’s realm couldn’t be loaded.</p>
				) : (
					<dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5" data-testid="phase-about">
						<dt className="text-[var(--g-ink-3)]">What it does</dt><dd>{purpose.text}{purpose.derived ? <span className="block text-[11.5px] text-[var(--g-ink-3)]">worked out from the team’s definition; the team gives no description</span> : null}</dd>
						<dt className="text-[var(--g-ink-3)]">Kind</dt><dd>{def?.type ?? 'standard'}{def?.agent || p.agent ? ` · agent ${def?.agent ?? p.agent}` : ''}</dd>
						{def?.depends_on.length ? <><dt className="text-[var(--g-ink-3)]">Works from</dt><dd className="g-mono">{def.depends_on.join(', ')}</dd></> : null}
						{def?.route_targets.length ? <><dt className="text-[var(--g-ink-3)]">Sends back to</dt><dd className="g-mono">{def.route_targets.join(', ')}{def.max_iterations ? ` · up to ${def.max_iterations}×` : ''}</dd></> : null}
						{def?.commands.length ? <><dt className="text-[var(--g-ink-3)]">Commands</dt><dd className="g-mono whitespace-pre-wrap break-words">{def.commands.join('\n')}</dd></> : null}
						{def?.hug ? <><dt className="text-[var(--g-ink-3)]">Asks with</dt><dd>hug <span className="g-mono">{def.hug}</span></dd></> : null}
						{def?.team ? <><dt className="text-[var(--g-ink-3)]">Sub-team</dt><dd className="g-mono">{def.team}</dd></> : null}
						{!def ? <><dt className="text-[var(--g-ink-3)]">Definition</dt><dd className="text-[var(--g-ink-3)]">The team version’s definition couldn’t be read.</dd></> : null}
					</dl>
				)}
			</div>
		</aside>
	);
}
