/**
 * Parts of the run page: the key-numbers strip, the phase inspector (live
 * feed, output, input, logs, usage) and the artifacts table.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import { relative_time } from '@/lib/overview';
import { format_duration, type Run_artifact, type Run_detail_phase } from '@/lib/realm_inbox';
import { fmt_count, fmt_ms, fmt_usd, KIND_LABEL, type Run_telemetry_data, type Telemetry_phase } from '@/lib/run_telemetry';
import { feed_line, type Feed_kind, type Gate_progress, type Run_event, type Run_route } from '@/lib/run_events';
import { G_run_logs } from '@/components/graphite/g_run_logs';

const CARD = 'rounded-[12px] border border-[var(--g-line)] bg-[var(--g-panel)]';
const LBL = 'text-[11.5px] text-[var(--g-ink-3)]';

export function fmt_bytes(n: number | null | undefined): string {
	if (n == null || !Number.isFinite(n)) return '—';
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// ── Key numbers ──────────────────────────────────────────────────────────

/** Elapsed · progress · cost · tokens · gate checks · time waiting on people. */
export function Run_kpis({ elapsed_ms, done, total, t, gates, human_phases }: {
	elapsed_ms: number | null;
	done: number;
	total: number;
	t: Run_telemetry_data | null;
	gates: Record<string, Gate_progress>;
	/** Human phases with the time people took on each. */
	human_phases: Array<{ name: string; ms: number }>;
}) {
	const gate = Object.entries(gates).at(-1) ?? null;
	const people = t?.totals.time.people_ms ?? human_phases.reduce((a, h) => a + h.ms, 0);
	const cells: Array<[string, ReactNode, ReactNode]> = [
		['Elapsed', fmt_ms(elapsed_ms), null],
		['Progress', `${done} / ${total} phases`, null],
		['Cost so far', fmt_usd(t?.totals.cost_usd ?? null), t && t.totals.cost_usd == null ? 'no model usage reported' : null],
		['Tokens', fmt_count(t?.totals.tokens_in != null || t?.totals.tokens_out != null ? (t.totals.tokens_in ?? 0) + (t.totals.tokens_out ?? 0) : null), t?.totals.tokens_in != null ? `in ${fmt_count(t.totals.tokens_in)} · out ${fmt_count(t.totals.tokens_out)}` : null],
		['Gate checks', gate ? `${gate[0]} ${gate[1].iteration ?? '?'}${gate[1].max ? ` / ${gate[1].max}` : ''}` : '—', gate ? gate[1].outcome?.toLowerCase() ?? null : 'no gate has run yet'],
		['Waiting on people', people ? fmt_ms(people) : '—', human_phases.length ? human_phases.map((h) => h.name).join(', ') : null],
	];
	return (
		<section aria-label="Run summary" className={`${CARD} grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6`} data-testid="run-kpis">
			{cells.map(([k, v, sub], i) => (
				<div key={k} className={`min-w-0 px-5 py-3.5 ${i ? 'border-l border-[var(--g-line)]' : ''}`}>
					<div className={LBL}>{k}</div>
					<div className="mt-1 truncate text-[18px] font-semibold">{v}{sub ? <span className="ml-1.5 text-[12px] font-normal text-[var(--g-ink-3)]">{sub}</span> : null}</div>
				</div>
			))}
		</section>
	);
}

// ── Inspector ────────────────────────────────────────────────────────────

export type Inspector_tab = 'live' | 'output' | 'input' | 'logs' | 'usage';
const TABS: Array<[Inspector_tab, string]> = [['live', 'Live'], ['output', 'Output'], ['input', 'Input'], ['logs', 'Logs'], ['usage', 'Usage']];
const FEED_TONE: Record<Feed_kind, string> = {
	thinking: 'text-[var(--g-ink)]', tool: 'text-[var(--g-ink-2)]', output: 'text-[var(--g-ink-2)]',
	verdict: 'text-[#ffc766]', route: 'text-[#ffc766]', status: 'text-[var(--g-ink-3)]', error: 'text-[var(--g-bad)]',
};

/** One phase of the run: what it is doing now, what it produced, what it got, its logs and usage. */
export function Phase_inspector({ phase, run_phase, tel, events, route, run_inputs, artifacts, depends_on, attempt, max_attempts, live, run_id, realm_id, log_query, tab, on_tab, on_rerun }: {
	phase: string;
	run_phase: Run_detail_phase | null;
	tel: Telemetry_phase | null;
	/** This phase's events, oldest first. */
	events: Run_event[];
	/** The gate route that last sent work back to this phase, if any. */
	route: Run_route | null;
	run_inputs: Record<string, unknown> | null;
	artifacts: Run_artifact[];
	depends_on: string[];
	attempt: number;
	max_attempts: number | null;
	live: boolean;
	run_id: string;
	realm_id: string | null;
	/** Search to open the logs with (e.g. one agent's lines). */
	log_query?: string | null;
	tab: Inspector_tab;
	on_tab: (t: Inspector_tab) => void;
	/** Resume the run from this phase; absent when the run can't resume. */
	on_rerun?: () => void;
}) {
	const lines = useMemo(() => events.map(feed_line).filter((x): x is NonNullable<typeof x> => x !== null), [events]);
	const kind = tel ? KIND_LABEL[tel.kind] : null;
	const meta = [run_phase?.agent ?? null, kind, attempt > 1 || max_attempts ? `attempt ${attempt}${max_attempts ? ` of ${max_attempts}` : ''}` : null, depends_on.length ? `after ${depends_on.join(', ')}` : null].filter(Boolean).join(' · ');
	const outputs = artifacts.filter((a) => a.phase === phase);
	const finished = events.filter((e) => e.type === 'phase.completed').at(-1);
	const summary = finished && typeof finished.payload.summary === 'string' ? finished.payload.summary : null;
	return (
		<aside className={`${CARD} flex min-h-[520px] flex-col overflow-hidden`} aria-label={`Phase ${phase}`} data-testid="phase-inspector">
			<header className="flex items-start gap-3 border-b border-[var(--g-line)] px-4 py-3.5">
				<div className="min-w-0 flex-1">
					<h2 className="g-mono truncate text-[15px] font-semibold">{phase}</h2>
					<p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">{meta || run_phase?.status || 'not started'}</p>
				</div>
				{on_rerun ? <button type="button" onClick={on_rerun} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--g-line)] px-2.5 text-[12px] font-semibold hover:bg-[var(--g-soft)]"><RotateCcw aria-hidden className="h-3 w-3" />Rerun from here</button> : null}
			</header>
			<div role="tablist" aria-label="Phase views" className="flex gap-1 border-b border-[var(--g-line)] px-3">
				{TABS.map(([id, label]) => (
					<button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => on_tab(id)} className={`-mb-px border-b-2 px-2.5 py-2.5 text-[12.5px] font-medium ${tab === id ? 'border-[var(--g-acc)] text-[var(--g-ink)]' : 'border-transparent text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>{label}</button>
				))}
			</div>
			<div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
				{tab === 'live' ? (
					<div className="px-4 py-3">
						{route ? (
							<div className="mb-3 rounded-lg border border-[rgba(245,165,36,.4)] bg-[var(--g-warn-soft)] px-3.5 py-2.5 text-[12.5px]" data-testid="route-banner">
								<p className="font-semibold text-[#ffc766]">Sent back by {route.gate}{route.iteration ? ` (check ${route.iteration}${route.max ? ` of ${route.max}` : ''})` : ''}</p>
								{route.reason ? <p className="mt-1 whitespace-pre-wrap text-[var(--g-ink-2)]">{route.reason}</p> : null}
								<p className="mt-1 text-[11.5px] text-[var(--g-ink-3)]">The gate’s feedback goes to this phase as input.</p>
							</div>
						) : null}
						{lines.length === 0 ? (
							<p className="py-8 text-center text-[12.5px] text-[var(--g-ink-3)]">{run_phase?.status === 'running' ? 'Waiting for the agent to report what it’s doing…' : run_phase?.started_at ? 'This phase didn’t report any activity.' : 'Not started yet.'}</p>
						) : (
							<ol aria-label="Activity" className="divide-y divide-[var(--g-line-2)]">
								{lines.map((l) => (
									<li key={l.id} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 py-2.5 text-[12.5px]">
										<span className="g-mono text-[11px] text-[var(--g-ink-3)]">{l.at ? clock(l.at) : ''}</span>
										<span className="min-w-0"><b className={`font-semibold ${FEED_TONE[l.kind]}`}>{l.title}</b>{l.text ? <span className={`${l.kind === 'tool' ? 'g-mono text-[12px]' : ''} ml-1.5 break-words text-[var(--g-ink-2)]`}>{l.text.length > 400 ? `${l.text.slice(0, 400)}…` : l.text}</span> : null}</span>
									</li>
								))}
								{live && run_phase?.status === 'running' ? <li className="py-2.5 text-[12px] text-[var(--g-ink-3)]"><span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--g-run)]" />working…</li> : null}
							</ol>
						)}
					</div>
				) : tab === 'output' ? (
					<div className="grid gap-3 px-4 py-3 text-[12.5px]">
						{summary ? <p className="whitespace-pre-wrap text-[var(--g-ink-2)]">{summary}</p> : null}
						{outputs.length ? outputs.map((a) => (
							<div key={a.artifact_id} className="flex items-center gap-3 rounded-lg border border-[var(--g-line)] px-3 py-2">
								<span className="min-w-0 flex-1"><span className="g-mono block truncate">{a.name}</span>{a.description ? <span className="block truncate text-[var(--g-ink-3)]">{a.description}</span> : null}</span>
								<span className="g-mono text-[11.5px] text-[var(--g-ink-3)]">{fmt_bytes(a.size_bytes)}</span>
								{a.download_url ? <a href={a.download_url} download={a.name} aria-label={`Download ${a.name}`} className="text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><Download aria-hidden className="h-3.5 w-3.5" /></a> : null}
							</div>
						)) : null}
						{run_phase?.error ? <pre className="g-mono whitespace-pre-wrap rounded-lg border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] px-3 py-2 text-[11.5px]">{run_phase.error}</pre> : null}
						{!summary && !outputs.length && !run_phase?.error ? <p className="py-6 text-center text-[var(--g-ink-3)]">{run_phase?.completed_at ? 'This phase didn’t save any files.' : 'Nothing yet — output appears when the phase finishes.'}</p> : null}
					</div>
				) : tab === 'input' ? (
					<div className="grid gap-3 px-4 py-3 text-[12.5px]">
						<p className="text-[var(--g-ink-3)]">{depends_on.length ? <>Gets the output of <span className="g-mono text-[var(--g-ink-2)]">{depends_on.join(', ')}</span>{route ? <> and the feedback from <span className="g-mono text-[var(--g-ink-2)]">{route.gate}</span></> : null}, plus the run’s inputs:</> : 'Starts from the run’s inputs:'}</p>
						{run_inputs && Object.keys(run_inputs).length ? (
							<dl className="g-mono grid gap-1.5 text-[12px]">
								{Object.entries(run_inputs).map(([k, v]) => <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-2"><dt className="truncate text-[var(--g-ink-3)]">{k}</dt><dd className="break-words">{typeof v === 'string' ? v : JSON.stringify(v)}</dd></div>)}
							</dl>
						) : <p className="text-[var(--g-ink-3)]">This run has no inputs.</p>}
					</div>
				) : tab === 'logs' ? (
					realm_id ? <div className="h-[520px]"><G_run_logs key={log_query ?? ''} run_id={run_id} realm_id={realm_id} live={live} initial_query={log_query ?? undefined} /></div>
						: <p className="px-4 py-6 text-[12.5px] text-[var(--g-ink-3)]">Logs are unavailable because this run’s realm couldn’t be loaded.</p>
				) : (
					<dl className="grid grid-cols-2 gap-4 px-4 py-4 text-[12.5px]">
						<div><dt className={LBL}>Time</dt><dd className="mt-1 text-[16px] font-semibold">{fmt_ms(tel?.duration_ms ?? null)}</dd></div>
						<div><dt className={LBL}>Cost (all attempts)</dt><dd className="mt-1 text-[16px] font-semibold">{fmt_usd(tel?.cost_usd ?? null)}</dd></div>
						<div><dt className={LBL}>Tokens in</dt><dd className="mt-1 text-[16px] font-semibold">{fmt_count(tel?.tokens_in ?? null)}</dd></div>
						<div><dt className={LBL}>Tokens out</dt><dd className="mt-1 text-[16px] font-semibold">{fmt_count(tel?.tokens_out ?? null)}</dd></div>
						<div><dt className={LBL}>Ran</dt><dd className="mt-1 text-[16px] font-semibold">{tel?.runs ?? attempt}×</dd></div>
						{tel?.gate_outcome ? <div><dt className={LBL}>Gate outcome</dt><dd className="mt-1 text-[16px] font-semibold">{tel.gate_outcome}</dd></div> : null}
						{!tel ? <p className="col-span-2 text-[var(--g-ink-3)]">No usage reported for this phase.</p> : null}
					</dl>
				)}
			</div>
			<footer className="grid grid-cols-3 gap-3 border-t border-[var(--g-line)] px-4 py-3 text-[12px]">
				<div><div className={LBL}>Agent</div><div className="mt-0.5 truncate font-semibold">{run_phase?.agent ?? '—'}</div></div>
				<div><div className={LBL}>Time</div><div className="mt-0.5 font-semibold">{run_phase?.started_at ? format_duration((run_phase.completed_at ?? Date.now()) - run_phase.started_at) : '—'}</div></div>
				<div><div className={LBL}>Cost</div><div className="mt-0.5 font-semibold">{fmt_usd(tel?.cost_usd ?? null)}</div></div>
			</footer>
		</aside>
	);
}

// ── Artifacts ────────────────────────────────────────────────────────────

/** Files the run's phases produced; each passes to the next phase as its input. */
export function Run_artifacts({ items, failed, on_phase }: { items: Run_artifact[]; failed: boolean; on_phase: (phase: string) => void }) {
	const [all, set_all] = useState(false);
	const shown = all ? items : items.slice(0, 8);
	return (
		<section className={`${CARD} overflow-hidden`} aria-label="Artifacts">
			<header className="flex items-center gap-2.5 border-b border-[var(--g-line)] px-4 py-3">
				<h2 className="text-[14px] font-semibold">Artifacts</h2>
				<span className="text-[12px] text-[var(--g-ink-3)]">files each phase produced, handed to the phases after it</span>
			</header>
			{failed ? <p className="px-4 py-5 text-[12.5px] text-[var(--g-ink-3)]">Artifacts couldn’t be loaded.</p> : items.length === 0 ? (
				<p className="px-4 py-5 text-[12.5px] text-[var(--g-ink-3)]">No files yet. Phases that save files show them here.</p>
			) : (
				<table className="w-full text-left text-[12.5px]">
					<thead><tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]"><th className="px-4 py-2 font-semibold">Phase</th><th className="px-4 py-2 font-semibold">File</th><th className="px-4 py-2 font-semibold">About</th><th className="px-4 py-2 text-right font-semibold">Size</th><th className="w-10" /></tr></thead>
					<tbody>
						{shown.map((a) => (
							<tr key={a.artifact_id} className="border-b border-[var(--g-line-2)] last:border-b-0">
								<td className="px-4 py-2.5"><button type="button" onClick={() => on_phase(a.phase)} className="g-mono hover:underline">{a.phase}</button></td>
								<td className="g-mono max-w-[220px] truncate px-4 py-2.5" title={a.name}>{a.name}</td>
								<td className="max-w-[360px] truncate px-4 py-2.5 text-[var(--g-ink-2)]" title={a.description ?? undefined}>{a.description ?? <span className="text-[var(--g-ink-3)]">{a.mime_type}</span>}</td>
								<td className="g-mono px-4 py-2.5 text-right text-[var(--g-ink-3)]">{fmt_bytes(a.size_bytes)}</td>
								<td className="px-3 py-2.5">{a.download_url ? <a href={a.download_url} download={a.name} aria-label={`Download ${a.name}`} className="text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><Download aria-hidden className="h-3.5 w-3.5" /></a> : null}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			{items.length > 8 ? <button type="button" onClick={() => set_all(!all)} className="w-full border-t border-[var(--g-line)] py-2 text-[12px] text-[var(--g-acc)] hover:bg-[var(--g-soft)]">{all ? 'Show fewer' : `Show all ${items.length}`}</button> : null}
		</section>
	);
}

/** Every event of the run, newest last (the Events view of the timeline card). */
export function Run_event_list({ events, on_phase }: { events: Run_event[]; on_phase: (phase: string) => void }) {
	const lines = events.map((e) => ({ e, l: feed_line(e) })).filter((x) => x.l !== null);
	if (!lines.length) return <p className="px-4 py-6 text-[12.5px] text-[var(--g-ink-3)]">No events yet.</p>;
	return (
		<ol className="max-h-[420px] divide-y divide-[var(--g-line-2)] overflow-y-auto" aria-label="Run events">
			{lines.slice(-300).map(({ e, l }) => (
				<li key={e.id} className="grid grid-cols-[72px_140px_minmax(0,1fr)] gap-3 px-4 py-2 text-[12.5px]">
					<span className="g-mono text-[11px] text-[var(--g-ink-3)]" title={e.at ? relative_time(e.at) : undefined}>{e.at ? clock(e.at) : ''}</span>
					{e.phase ? <button type="button" onClick={() => on_phase(e.phase!)} className="g-mono truncate text-left hover:underline">{e.phase}</button> : <span className="text-[var(--g-ink-3)]">run</span>}
					<span className="min-w-0 truncate"><b className={`font-semibold ${FEED_TONE[l!.kind]}`}>{l!.title}</b>{l!.text ? <span className="ml-1.5 text-[var(--g-ink-2)]">{l!.text}</span> : null}</span>
				</li>
			))}
		</ol>
	);
}
