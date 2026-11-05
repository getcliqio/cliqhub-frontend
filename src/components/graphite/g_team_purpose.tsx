/**
 * What a team is for, so a person can pick the right one to start: its team.yml `use_when`
 * (start it when…) and `not_for` (start another one when…) — the run dialog and the team's page.
 */

export interface Team_purpose_data {
	description?: string | null;
	use_when?: string[];
	not_for?: string[];
	required_inputs?: Array<{ name: string; description: string | null }>;
}

const has_lists = (p: Team_purpose_data) => Boolean(p.use_when?.length || p.not_for?.length);

/** "Use when" / "Not for" bullet lists. */
export function Team_purpose({ purpose, className = '' }: { purpose: Team_purpose_data; className?: string }) {
	if (!has_lists(purpose)) return null;
	return (
		<div className={`grid gap-3 text-[12px] sm:grid-cols-2 ${className}`} data-testid="team-purpose">
			{purpose.use_when?.length ? (
				<div>
					<p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ok)]">Use when</p>
					<ul className="flex list-disc flex-col gap-0.5 pl-4 text-[var(--g-ink-2)]">{purpose.use_when.map((s) => <li key={s}>{s}</li>)}</ul>
				</div>
			) : null}
			{purpose.not_for?.length ? (
				<div>
					<p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]">Not for</p>
					<ul className="flex list-disc flex-col gap-0.5 pl-4 text-[var(--g-ink-2)]">{purpose.not_for.map((s) => <li key={s}>{s}</li>)}</ul>
				</div>
			) : null}
		</div>
	);
}
