/**
 * What a team is for, so a person can pick the right one to start: its team.yml `use_when`
 * (start it when…) and `not_for` (start another one when…), plus the inputs a run needs.
 *   Team_purpose_line — one line under a team's name in a list, with a "When to use" toggle.
 *   Team_purpose      — the full lists (the run dialog).
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

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

/** Under a team's name: its first "use when" (else its description), the inputs it needs, and a toggle for the rest. */
export function Team_purpose_line({ purpose }: { purpose: Team_purpose_data }) {
	const [open, set_open] = useState(false);
	const lead = purpose.use_when?.[0] ?? purpose.description ?? null;
	const needs = (purpose.required_inputs ?? []).map((i) => i.name);
	if (!lead && !needs.length) return null;
	const more = has_lists(purpose) && ((purpose.use_when?.length ?? 0) > 1 || (purpose.not_for?.length ?? 0) > 0);
	return (
		<span className="flex flex-col gap-1" data-testid="team-purpose-line">
			<span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px] text-[var(--g-ink-2)]">
				{lead ? <span className="line-clamp-2">{lead}</span> : null}
				{needs.length ? <span className="g-mono text-[11px] text-[var(--g-ink-3)]" title={(purpose.required_inputs ?? []).map((i) => `${i.name}${i.description ? `: ${i.description}` : ''}`).join('\n')}>needs {needs.join(', ')}</span> : null}
				{more ? (
					<button type="button" aria-expanded={open} onClick={(e) => { e.stopPropagation(); set_open((v) => !v); }} className="inline-flex items-center gap-0.5 text-[11px] text-[var(--g-acc)] hover:underline" data-testid="purpose-toggle">
						{open ? <ChevronDown aria-hidden className="h-3 w-3" /> : <ChevronRight aria-hidden className="h-3 w-3" />}When to use
					</button>
				) : null}
			</span>
			{open ? <span onClick={(e) => e.stopPropagation()}><Team_purpose purpose={purpose} className="mt-1 rounded-md bg-[var(--g-soft)] p-2.5" /></span> : null}
		</span>
	);
}
