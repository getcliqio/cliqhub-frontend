/**
 * A team's details, out of the way of its header: the full description, when to use it and when not to
 * (team.yml `use_when` / `not_for`), the sub-teams it runs, and who made it. Opened from "Details" on the
 * team's page; the header keeps only the title, a two-line description and the author and tags.
 */
import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Team_purpose, type Team_purpose_data } from '@/components/graphite/g_team_purpose';

/** Is there anything the header doesn't already show in full? */
export function has_details(team: Team_purpose_data, sub_team_count: number): boolean {
	return Boolean(team.description || team.use_when?.length || team.not_for?.length || sub_team_count);
}

export function Team_details_drawer({ title, version, team, author, tags, structure, on_close }: {
	/** `@scope/name`. */
	title: string;
	version: string | null;
	team: Team_purpose_data;
	author: string | null;
	tags: string[];
	/** The sub-team tree, when the team runs any. */
	structure: ReactNode;
	on_close: () => void;
}) {
	useEffect(() => {
		const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') on_close(); };
		window.addEventListener('keydown', esc);
		return () => window.removeEventListener('keydown', esc);
	}, [on_close]);
	const section = 'text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]';
	return (
		<div className="fixed inset-0 z-50 flex justify-end bg-[var(--g-backdrop)]" role="dialog" aria-label={`About ${title}`} onMouseDown={(e) => { if (e.target === e.currentTarget) on_close(); }}>
			<div className="flex h-full w-[520px] max-w-full flex-col gap-5 overflow-y-auto border-l border-[var(--g-line-strong)] bg-[var(--g-panel)] px-6 py-5 shadow-[var(--g-drawer-shadow)]" data-testid="team-details">
				<div className="flex items-center gap-2">
					<h2 className="g-mono truncate text-[15px] font-semibold">{title}</h2>
					{version ? <span className="g-mono text-[12.5px] text-[var(--g-ink-3)]">v{version}</span> : null}
					<button type="button" onClick={on_close} aria-label="Close" className="ml-auto text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><X className="h-4 w-4" /></button>
				</div>
				{team.description ? <p className="whitespace-pre-line text-[13px] leading-relaxed text-[var(--g-ink-2)]">{team.description}</p> : null}
				<Team_purpose purpose={team} className="!grid-cols-1 gap-4" />
				{structure ? (
					<div className="flex flex-col gap-1.5">
						<p className={section}>Sub-teams</p>
						{structure}
					</div>
				) : null}
				{author || tags.length ? (
					<dl className="grid grid-cols-[80px_1fr] gap-y-1.5 border-t border-[var(--g-line)] pt-4 text-[12.5px]">
						{author ? <><dt className="text-[var(--g-ink-3)]">Author</dt><dd>{author}</dd></> : null}
						{tags.length ? <><dt className="text-[var(--g-ink-3)]">Tags</dt><dd className="flex flex-wrap gap-1">{tags.map((t) => <span key={t} className="rounded bg-[var(--g-soft)] px-1.5 py-px text-[11.5px]">{t}</span>)}</dd></> : null}
					</dl>
				) : null}
			</div>
		</div>
	);
}
