/**
 * The one place the builder lists errors and warnings (left panel, under the
 * shape palette). Each row selects the phase it is about (or opens the team
 * details for team-wide problems); a quick fix, when there is one, applies in
 * place. The canvas keeps only a small dot on the node itself.
 */
import type { GeneratedTeam } from '@/lib/builder/store';
import type { Problem } from '@/lib/builder/checks';

export function Problems_list({ team, problems, on_open, on_change }: {
	team: GeneratedTeam;
	problems: Problem[];
	/** Show the problem's phase (or the team when `phase` is null). */
	on_open: (phase: string | null) => void;
	on_change: (next: GeneratedTeam) => void;
}) {
	const errors = problems.filter((p) => p.level === 'error').length;
	const warnings = problems.length - errors;
	const sorted = [...problems].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
	return (
		<section aria-labelledby="gb-problems-title" className="flex min-h-0 flex-col border-t border-[var(--g-line)]" data-testid="problems">
			<h2 id="gb-problems-title" className="flex items-center gap-1.5 px-4 pb-1.5 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">
				Problems
				<span className="ml-auto flex gap-1 normal-case tracking-normal" data-testid="problems-count">
					{errors ? <span className="rounded-full bg-[var(--g-bad-soft)] px-1.5 text-[11px] font-semibold text-[var(--g-bad)]">{errors} error{errors === 1 ? '' : 's'}</span> : null}
					{warnings ? <span className="rounded-full bg-[var(--g-warn-soft)] px-1.5 text-[11px] font-semibold text-[var(--g-warn-text)]">{warnings} warning{warnings === 1 ? '' : 's'}</span> : null}
				</span>
			</h2>
			{!errors ? (
				<p className="px-4 pb-2 text-[12px] text-[var(--g-ok)]" role="status">{team.phases.length ? '✓ Valid workflow' : 'Nothing to check yet.'}</p>
			) : null}
			{problems.length ? (
				<ul className="min-h-0 overflow-y-auto px-2 pb-2">
					{sorted.map((p) => {
						const err = p.level === 'error';
						return (
							<li key={p.id} className="group flex items-start gap-1 rounded-md hover:bg-[var(--g-soft)]">
								<button type="button" onClick={() => on_open(p.phase)} className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left text-[12px] leading-snug" title={p.phase ? `Open ${p.phase}` : 'Open team details'}>
									<span aria-hidden className="mt-[1px] w-3 shrink-0 text-center font-bold" style={{ color: err ? 'var(--g-bad)' : 'var(--g-warn)' }}>{err ? '✕' : '!'}</span>
									<span className="sr-only">{err ? 'Error' : 'Warning'}:</span>
									<span className="min-w-0 text-[var(--g-ink-2)]">
										{p.phase && !p.message.startsWith(p.phase) ? <b className="g-mono mr-1 font-semibold text-[var(--g-ink)]">{p.phase}</b> : null}
										{p.message}
									</span>
								</button>
								{p.fix ? <button type="button" onClick={() => on_change(p.fix!.apply(team))} className="mr-1 mt-1 shrink-0 rounded px-1.5 py-0.5 text-[11.5px] font-semibold text-[var(--g-acc)] hover:bg-[var(--g-acc-soft)]">{p.fix.label}</button> : null}
							</li>
						);
					})}
				</ul>
			) : null}
		</section>
	);
}
