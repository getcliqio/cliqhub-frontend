/**
 * The run's sub-teams as a tree inside the Phases tab: a team phase opens into its sub-team run's
 * steps, at any depth (from the telemetry read's `sub_runs`). Selecting a step shows
 * {@link Step_details} — its status, re-runs, time, cost and error, plus its output read from
 * that sub-team run (`run_detail/get`, once per run, on demand).
 */
import { Link } from 'react-router';
import { fmt_ms, fmt_usd, type Telemetry_phase, type Telemetry_sub_run } from '@/lib/run_telemetry';
import { use_bff_read } from '@/lib/use_bff_read';
import type { Run_detail_data, Run_failure } from '@/lib/realm_inbox';
import { State_dot, State_pill } from '@/components/graphite/g_status';
import { G_phase_output } from '@/components/graphite/g_phase_output';

const short_team = (t: string | null) => (t ?? '').replace(/^@[^/]+\//, '');
const FAILED = new Set(['failed', 'crashed', 'error']);
const LIVE = new Set(['running', 'awaiting_input', 'pending_input']);

/** A step chosen in the tree: which sub-team run, which of its phases, and the path to it. */
export interface Tree_step {
	run: Telemetry_sub_run;
	phase: Telemetry_phase;
	/** Team names from the top run down to this sub-team, e.g. ['design-lld']. */
	path: string[];
}

/** Tree keys: a sub-team run is open unless folded; failed or live ones start open. */
export function initially_open(subs: Telemetry_sub_run[] | undefined, out = new Set<string>()): Set<string> {
	for (const r of subs ?? []) {
		if (FAILED.has(r.state) || LIVE.has(r.state)) out.add(r.run_id);
		for (const p of r.phases) initially_open(p.sub_runs, out);
	}
	return out;
}

/** Every sub-team run id in the tree (for "Expand all"). */
export function all_sub_runs(subs: Telemetry_sub_run[] | undefined, out = new Set<string>()): Set<string> {
	for (const r of subs ?? []) { out.add(r.run_id); for (const p of r.phases) all_sub_runs(p.sub_runs, out); }
	return out;
}

const dur = (p: { start_ms: number | null; end_ms: number | null }, now: number) => (p.start_ms != null ? fmt_ms((p.end_ms ?? now) - p.start_ms) : '—');

export function Sub_team_tree({ subs, open, toggle, selected, on_select, run_href, depth = 1, path = [], now = Date.now() }: {
	subs: Telemetry_sub_run[];
	open: Set<string>;
	toggle: (run_id: string) => void;
	selected: { run_id: string; phase: string } | null;
	on_select: (s: Tree_step) => void;
	run_href: (run_id: string) => string;
	depth?: number;
	path?: string[];
	now?: number;
}) {
	return (
		<ul className="mt-1.5 flex flex-col" aria-label="Sub-team runs" onClick={(e) => e.stopPropagation()}>
			{subs.map((r) => {
				const is_open = open.has(r.run_id);
				const team = short_team(r.team) || r.run_name || r.run_id;
				const here = [...path, team];
				return (
					<li key={r.run_id} data-testid={`tree-run-${r.run_id}`}>
						<div className="grid grid-cols-[minmax(0,1fr)_auto_64px_52px] items-center gap-2 rounded-md bg-[var(--g-soft)] px-2 py-1 text-[12.5px]" style={{ marginLeft: `${(depth - 1) * 16}px` }}>
							<span className="flex min-w-0 items-center gap-1.5">
								<button type="button" aria-expanded={is_open} aria-label={`${is_open ? 'Fold' : 'Open'} sub-team ${team}`} onClick={() => toggle(r.run_id)} className="text-[11px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">{is_open ? '▾' : '▸'}</button>
								<span aria-hidden className="text-[var(--g-ink-3)]">⤷</span>
								<span className="g-mono font-semibold">{team}</span>
								{r.run_name ? <Link to={run_href(r.run_id)} className="g-mono min-w-0 truncate text-[11.5px] text-[var(--g-acc)] hover:underline">{r.run_name} ↗</Link> : null}
								{!is_open ? <span className="shrink-0 text-[11px] text-[var(--g-ink-3)]">{r.phases.length} step{r.phases.length === 1 ? '' : 's'}</span> : null}
							</span>
							<State_pill state={r.state} />
							<span className="g-mono text-right text-[12px] text-[var(--g-ink-3)]">{dur(r, now)}</span>
							<span className="g-mono text-right text-[12px] text-[var(--g-ink-2)]">{r.usage?.cost_usd != null ? fmt_usd(r.usage.cost_usd) : ''}</span>
						</div>
						{is_open ? (
							<ul className="flex flex-col" aria-label={`Steps of ${team}`}>
								{r.phases.map((p) => {
									const sel = selected?.run_id === r.run_id && selected.phase === p.name;
									return (
										<li key={p.name}>
											<button
												type="button"
												data-testid={`tree-step-${r.run_id}-${p.name}`}
												aria-pressed={sel}
												onClick={() => on_select({ run: r, phase: p, path: here })}
												className={`grid w-full grid-cols-[minmax(0,1fr)_auto_64px_52px] items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-[var(--g-soft)] ${sel ? 'ring-1 ring-[var(--g-acc-line)]' : ''}`}
												style={{ paddingLeft: `${(depth - 1) * 16 + 30}px` }}
											>
												<span className="flex min-w-0 items-center gap-1.5">
													<State_dot state={p.status} pulse={LIVE.has(p.status)} />
													<span className={`g-mono truncate ${FAILED.has(p.status) ? 'text-[var(--g-bad)]' : ''}`}>{p.name}</span>
													{p.runs > 1 ? <span className="shrink-0 rounded bg-[var(--g-warn-soft)] px-1.5 text-[10.5px] text-[var(--g-warn-text)]">{p.kind === 'human' || p.kind === 'gate' ? `${p.runs} rounds` : `ran ${p.runs}×`}</span> : null}
												</span>
												<span className="text-[11.5px] text-[var(--g-ink-3)]">{p.status}</span>
												<span className="g-mono text-right text-[12px] text-[var(--g-ink-3)]">{dur(p, now)}</span>
												<span className="g-mono text-right text-[12px] text-[var(--g-ink-2)]">{p.cost_usd != null ? fmt_usd(p.cost_usd) : ''}</span>
											</button>
											{p.sub_runs?.length ? (
												<Sub_team_tree subs={p.sub_runs} open={open} toggle={toggle} selected={selected} on_select={on_select} run_href={run_href} depth={depth + 1} path={here} now={now} />
											) : null}
										</li>
									);
								})}
							</ul>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}

/** The side panel for a step chosen in the tree. */
export function Step_details({ step, top, failure, run_href, on_close }: {
	step: Tree_step;
	/** The top run's name (start of the path). */
	top: string;
	/** The page's "why it failed", shown here when this step is where it broke. */
	failure: Run_failure | null;
	run_href: (run_id: string) => string;
	on_close: () => void;
}) {
	const { run, phase: p, path } = step;
	const detail = use_bff_read<Run_detail_data>('/v1/run_detail/get', { run_id: run.run_id }, { fallback_error: 'Could not load this step’s output.' });
	const outputs = (detail.data?.phase_outputs ?? []).filter((o) => o.phase === p.name);
	const leaf = failure?.chain[failure.chain.length - 1];
	const broke_here = leaf && leaf.run_id === run.run_id && leaf.phase === p.name ? failure : null;
	const failed_run = FAILED.has(run.state);
	return (
		<aside aria-label="Step details" data-testid="step-details" className="flex flex-col gap-3 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4 text-[12.5px]">
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					<p className="truncate text-[11.5px] text-[var(--g-ink-3)]" data-testid="step-path">{[top, ...path].join(' › ')} ›</p>
					<p className="mt-0.5 flex flex-wrap items-center gap-2"><span className="g-mono text-[15px] font-semibold">{p.name}</span><State_pill state={p.status} /></p>
				</div>
				<button type="button" onClick={on_close} aria-label="Close step details" className="text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">✕</button>
			</div>
			<dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-1">
				<dt className="text-[var(--g-ink-3)]">Time</dt><dd className="g-mono">{dur(p, Date.now())}</dd>
				{p.runs > 1 ? <><dt className="text-[var(--g-ink-3)]">Ran</dt><dd>{p.runs}× (sent back for rework)</dd></> : null}
				{p.cost_usd != null ? <><dt className="text-[var(--g-ink-3)]">Cost</dt><dd className="g-mono">{fmt_usd(p.cost_usd)}</dd></> : null}
				{p.tokens_in != null ? <><dt className="text-[var(--g-ink-3)]">Tokens</dt><dd className="g-mono">{p.tokens_in.toLocaleString()} in · {(p.tokens_out ?? 0).toLocaleString()} out</dd></> : null}
			</dl>
			{broke_here ? (
				<div className="rounded-md border border-[var(--g-bad-line)] px-3 py-2" data-testid="step-failure">
					<p className="font-semibold">{broke_here.summary}</p>
					{broke_here.review?.reviewers.length ? (
						<ul className="mt-1.5 grid gap-0.5 text-[12px]">
							{broke_here.review.reviewers.map((r) => <li key={r.name} className="flex justify-between gap-2"><span>{r.name}</span><span className="text-[var(--g-ink-3)]">{r.action ?? 'No response'}</span></li>)}
						</ul>
					) : null}
				</div>
			) : null}
			{p.error ? <pre className="g-mono max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--g-bg)] px-3 py-2 text-[11.5px] text-[var(--g-bad)]" data-testid="step-error">{p.error}</pre> : null}
			{outputs.length ? <G_phase_output outputs={outputs} run_link={run_href} /> : detail.status === 'loading' ? <p className="text-[var(--g-ink-3)]">Loading output…</p> : null}
			<div className="flex flex-wrap gap-2">
				{failed_run ? <Link to={`${run_href(run.run_id)}?resume=${encodeURIComponent(p.name)}`} className="inline-flex h-7 items-center rounded-md border border-[var(--g-line)] px-2.5 text-[12px] font-semibold hover:bg-[var(--g-soft)]">Resume sub-team from {p.name}</Link> : null}
				{broke_here?.review ? <Link to={`/reviews/${broke_here.review.review_id}`} className="inline-flex h-7 items-center rounded-md border border-[var(--g-line)] px-2.5 text-[12px] font-semibold hover:bg-[var(--g-soft)]">Open review</Link> : null}
				<Link to={`${run_href(run.run_id)}?tab=logs`} className="inline-flex h-7 items-center rounded-md border border-[var(--g-line)] px-2.5 text-[12px] font-semibold hover:bg-[var(--g-soft)]">Logs</Link>
				<Link to={run_href(run.run_id)} className="inline-flex h-7 items-center rounded-md border border-[var(--g-line)] px-2.5 text-[12px] font-semibold hover:bg-[var(--g-soft)]">Open sub-team run ↗</Link>
			</div>
		</aside>
	);
}
