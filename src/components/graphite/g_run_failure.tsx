/**
 * "Why it failed" — the run page's card for a failed / crashed / cancelled run (BFF
 * `run_detail.failure`): the reason in plain words, where it broke (through sub-teams), a
 * review's reviewers and answers, the error as recorded, and what to do next.
 *
 * A failure inside a sub-team is resumed in two steps: resume the sub-team run from its phase
 * (its page opens with the resume panel set), then — once it succeeds — resume this run from
 * the phase that started it (the phase list offers that).
 */
import { Link } from 'react-router';
import type { Run_failure, Run_failure_reason } from '@/lib/realm_inbox';
import { relative_time } from '@/lib/overview';

const REASON_LABEL: Record<Run_failure_reason, string> = {
	review_timed_out: 'Review timed out',
	review_rejected: 'Review rejected',
	review_escalated: 'Escalated',
	gate_exhausted: 'Out of retries',
	permission: 'Permissions',
	agent_crashed: 'Agent crashed',
	agent_error: 'Agent error',
	timed_out: 'Timed out',
	missing_setup: 'Missing setup',
	cancelled: 'Cancelled',
	daemon_crashed: 'Daemon stopped',
	unknown: 'Unknown',
};

/** "ROUTE:draft-lld" → "Sent back to draft-lld"; PASS → Approved; REJECT → Rejected. */
function answer(action: string | null): { text: string; tone: 'ok' | 'warn' | 'none' } {
	if (!action) return { text: 'No response', tone: 'none' };
	if (action === 'PASS' || action === 'APPROVE') return { text: 'Approved', tone: 'ok' };
	if (action.startsWith('ROUTE:')) return { text: `Sent back to ${action.slice(6)}`, tone: 'warn' };
	if (action === 'REJECT' || action === 'REWORK') return { text: 'Rejected', tone: 'warn' };
	return { text: action, tone: 'warn' };
}

const short_team = (t: string | null) => (t ?? '').replace(/^@[^/]+\//, '');
const CHIP = 'inline-flex items-center gap-1 rounded-md border border-[var(--g-line)] px-2 py-0.5 text-[12px]';
const BTN = 'inline-flex h-8 items-center rounded-md border border-[var(--g-line)] px-3 text-[12.5px] font-semibold hover:bg-[var(--g-soft)]';

export function Run_failure_card({ failure: f, run_href, on_resume, on_logs, can_run }: {
	failure: Run_failure;
	/** Page path of a run in this realm. */
	run_href: (run_id: string) => string;
	/** Resume this run from a phase (opens the resume panel set to it). */
	on_resume: (phase: string) => void;
	/** Open this run's logs. */
	on_logs: () => void;
	/** Whether the viewer may resume runs. */
	can_run: boolean;
}) {
	const leaf = f.chain[f.chain.length - 1];
	const in_sub_team = f.chain.length > 1 && leaf;
	const resume_phase = f.resume_from;
	return (
		<section aria-label="Why it failed" data-testid="run-failure" className="rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-panel)] px-4 py-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-[13.5px] font-semibold">Why it failed</span>
				<span data-testid="failure-reason" className="rounded-md bg-[var(--g-bad-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--g-bad-text,var(--g-bad))]">{REASON_LABEL[f.reason]}</span>
				<span className="text-[13px] text-[var(--g-ink-2)]" data-testid="failure-summary">{f.summary}</span>
			</div>

			{f.chain.some((s) => s.phase) ? (
				<div className="mt-2.5 flex flex-wrap items-center gap-1.5" data-testid="failure-where">
					<span className="mr-1 text-[11.5px] text-[var(--g-ink-3)]">Where</span>
					{f.chain.map((s, i) => (
						<span key={s.run_id} className="contents">
							{i > 0 ? (
								<>
									<span aria-hidden className="text-[var(--g-ink-4)]">›</span>
									<Link to={run_href(s.run_id)} className={`${CHIP} hover:bg-[var(--g-soft)]`} title={s.team ?? undefined}>
										<span className="text-[var(--g-ink-3)]">sub-team</span> <span className="g-mono font-semibold">{short_team(s.team) || s.run_name}</span>
										{s.run_name ? <span className="g-mono text-[var(--g-ink-3)]">{s.run_name}</span> : null}
									</Link>
								</>
							) : null}
							{s.phase ? (
								<>
									{i > 0 ? <span aria-hidden className="text-[var(--g-ink-4)]">›</span> : null}
									<span className={`${CHIP} g-mono ${i === f.chain.length - 1 ? 'border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] text-[var(--g-bad-text,var(--g-bad))]' : ''}`}>{s.phase}</span>
								</>
							) : null}
						</span>
					))}
				</div>
			) : null}

			{f.review && f.review.reviewers.length ? (
				<div className="mt-3 overflow-hidden rounded-md border border-[var(--g-line)]" data-testid="failure-reviewers">
					<p className="border-b border-[var(--g-line)] px-3 py-1.5 text-[11.5px] text-[var(--g-ink-3)]">
						Sent to {f.review.reviewers.length} {f.review.policy === 'all' ? '— everyone had to approve' : f.review.policy === 'any' ? '— any one could decide' : ''}
					</p>
					{f.review.reviewers.map((r) => {
						const a = answer(r.action);
						return (
							<div key={r.name} data-testid="failure-reviewer" className="grid grid-cols-[minmax(0,1fr)_auto_90px] items-center gap-3 border-b border-[var(--g-line)] px-3 py-1.5 text-[12.5px] last:border-b-0">
								<span className="truncate">{r.name}{r.comment ? <span className="ml-2 text-[11.5px] text-[var(--g-ink-3)]">“{r.comment}”</span> : null}</span>
								<span className={a.tone === 'ok' ? 'text-[var(--g-ok-text,var(--g-ok))]' : a.tone === 'warn' ? 'text-[var(--g-warn-text)]' : 'text-[var(--g-ink-3)]'}>{a.text}</span>
								<span className="text-right text-[11.5px] text-[var(--g-ink-3)]">{r.responded_at ? relative_time(Date.parse(r.responded_at)) : '—'}</span>
							</div>
						);
					})}
				</div>
			) : null}

			{f.hint ? <p className="mt-2.5 text-[12.5px] text-[var(--g-ink-2)]" data-testid="failure-hint">{f.hint}</p> : null}

			{f.detail ? (
				<details className="mt-2">
					<summary className="cursor-pointer text-[11.5px] text-[var(--g-ink-3)]">Error as recorded</summary>
					<pre className="g-mono mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--g-bg)] px-3 py-2 text-[11.5px] text-[var(--g-ink-2)]" data-testid="failure-detail">{f.detail}</pre>
				</details>
			) : null}

			<div className="mt-3 flex flex-wrap items-center gap-2">
				{resume_phase && can_run ? (
					in_sub_team ? (
						<Link to={`${run_href(leaf.run_id)}?resume=${encodeURIComponent(resume_phase)}`} className={BTN} data-testid="failure-resume">Resume sub-team from {resume_phase}</Link>
					) : (
						<button type="button" className={BTN} onClick={() => on_resume(resume_phase)} data-testid="failure-resume">Resume from {resume_phase}</button>
					)
				) : null}
				{f.review ? <Link to={`/reviews/${f.review.review_id}`} className={BTN}>Open review</Link> : null}
				{in_sub_team
					? <Link to={`${run_href(leaf.run_id)}?tab=logs`} className={BTN}>Sub-team logs</Link>
					: <button type="button" className={BTN} onClick={on_logs}>Logs</button>}
				{in_sub_team && resume_phase && can_run && f.chain[0].phase ? (
					<span className="text-[11.5px] text-[var(--g-ink-3)]" data-testid="failure-two-step">Then, once it succeeds, resume this run from <span className="g-mono">{f.chain[0].phase}</span>.</span>
				) : null}
			</div>
		</section>
	);
}
