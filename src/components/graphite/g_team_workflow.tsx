/**
 * A team's workflow with its sub-teams (Graphite). Steps that run another team can be opened
 * ("N steps ›" on the node; a path above leads back up) or, with Sub-teams: Expanded, drawn in
 * place inside labelled frames, at every depth. Selection, the start node and the run overlay
 * belong to the team itself, so they apply at the top level (and to its own steps when expanded).
 * `below` draws something that follows the same view (the realm page's step table).
 */
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Workflow_graph } from '@/components/graphite/g_workflow_graph';
import { expand_sub_teams, type Team_phase, type Team_sub_team } from '@/lib/team_page';

type Graph_props = ComponentProps<typeof Workflow_graph>;

/** What the diagram is showing, for whatever is drawn below it. */
export interface Workflow_view_state {
	/** The team itself (not a sub-team opened from it). */
	top: boolean;
	/** The steps of the team being shown. */
	phases: Team_phase[];
	sub_teams: Record<string, Team_sub_team>;
	expanded: boolean;
	/** The selected step: the page's at the top, the view's own inside a sub-team. */
	selected: string | null;
	pick: (name: string) => void;
	open: (ref: string) => void;
}

export function Team_workflow({
	team_name,
	phases,
	sub_teams = null,
	selected = null,
	on_select,
	statuses = null,
	start = null,
	height = 220,
	below,
	graph_class,
}: {
	/** The team's own name, first in the path. */
	team_name: string;
	phases: Team_phase[];
	sub_teams?: Record<string, Team_sub_team> | null;
	below?: (view: Workflow_view_state) => ReactNode;
	/** Classes for the path bar + diagram (`below` is drawn after it, outside). */
	graph_class?: string;
} & Pick<Graph_props, 'selected' | 'on_select' | 'statuses' | 'start' | 'height'>) {
	const [path, set_path] = useState<string[]>([]);
	const [expanded, set_expanded] = useState(false);
	/** Selected step inside an opened sub-team (the page's selection is the team's own). */
	const [inner_sel, set_inner_sel] = useState<string | null>(null);
	const subs = sub_teams ?? {};
	const shown = path.filter((ref) => subs[ref]);
	const here = shown.length ? subs[shown[shown.length - 1]].phases : phases;
	const has_subs = here.some((p) => p.team && subs[p.team]);
	const view = expanded && has_subs ? expand_sub_teams(here, subs) : { phases: here, groups: [] };
	const top = shown.length === 0;
	// Steps inside an expanded sub-team are not this team's own: they can't be selected.
	const own_select = top && on_select ? (n: string) => { if (!n.includes('/')) on_select(n); } : undefined;
	const go = (next: string[]) => { set_path(next); set_inner_sel(null); };

	return (
		<div>
			<div className={graph_class}>
			{has_subs || shown.length ? (
				<div className="flex flex-wrap items-center gap-2 px-3.5 pt-2.5 text-[12px]" data-testid="workflow-path">
					<nav aria-label="Sub-team path" className="flex flex-wrap items-center gap-1 text-[var(--g-ink-3)]">
						{[team_name, ...shown.map((ref) => subs[ref].name)].map((label, i, all) => (
							<span key={`${label}-${i}`} className="inline-flex items-center gap-1">
								{i > 0 ? <span aria-hidden>›</span> : null}
								{i === all.length - 1
									? <span className="font-semibold text-[var(--g-ink)]" aria-current="page">{label}</span>
									: <button type="button" className="hover:text-[var(--g-ink)] hover:underline" onClick={() => go(shown.slice(0, i))}>{label}</button>}
							</span>
						))}
					</nav>
					{has_subs ? (
						<div role="group" aria-label="Sub-teams" className="ml-auto flex items-center gap-1.5 text-[var(--g-ink-3)]">
							Sub-teams:
							<div className="flex overflow-hidden rounded-md border border-[var(--g-line-strong)]">
								{([['Collapsed', false], ['Expanded', true]] as const).map(([text, on]) => (
									<button
										key={text}
										type="button"
										aria-pressed={expanded === on}
										onClick={() => set_expanded(on)}
										className={`h-6 px-2 text-[11.5px] ${expanded === on ? 'bg-[var(--g-soft)] font-semibold text-[var(--g-ink)]' : 'hover:text-[var(--g-ink)]'}`}
									>{text}</button>
								))}
							</div>
						</div>
					) : null}
				</div>
			) : null}
			<Workflow_graph
				phases={view.phases}
				groups={view.groups}
				sub_teams={subs}
				on_open={(ref) => go([...shown, ref])}
				height={height}
				label={shown.length ? `${subs[shown[shown.length - 1]].name} workflow` : 'Team workflow'}
				selected={top ? selected : null}
				on_select={own_select}
				statuses={top ? statuses : null}
				start={top ? start : null}
			/>
			</div>
			{below?.({
				top, phases: here, sub_teams: subs, expanded: expanded && has_subs,
				selected: top ? selected ?? null : inner_sel,
				pick: top ? (n) => on_select?.(n) : (n) => set_inner_sel((cur) => (cur === n ? null : n)),
				open: (ref) => go([...shown, ref]),
			})}
		</div>
	);
}
