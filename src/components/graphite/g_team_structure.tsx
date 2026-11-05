/**
 * A team's sub-team tree, under its title on the team's page: the sub-teams its phases run, nested, each with
 * the phase that runs it and the version used (installed in the realm, pinned, or the latest). A sub-team links
 * to its own page; a level folds from its chevron (two levels open at first). Built by the BFF (`overview.tree`).
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Team_tree_node } from '@/lib/team_page';

/** Levels open at first. */
const OPEN_DEPTH = 2;

/** `@scope/name` (and `@version` when pinned) → its label and pin. */
export function ref_label(ref: string): { label: string; pin: string | null } {
	const m = /^@?([^/@\s]+)\/([^/@\s]+)(?:@([\w.-]+))?$/.exec(ref.trim());
	if (!m) return { label: ref, pin: null };
	return { label: `@${m[1]}/${m[2]}`, pin: m[3] && m[3].toLowerCase() !== 'latest' ? m[3] : null };
}

export function Team_structure({ root, href, on_phase }: {
	root: Team_tree_node;
	/** A sub-team's page, or null when it has none. */
	href: (node: Team_tree_node) => string | null;
	/** A phase name was clicked: select it in the Phases card (the root's own phases only). */
	on_phase?: (name: string) => void;
}) {
	const [toggled, set_toggled] = useState<Set<string>>(() => new Set());
	if (!root.children.length) return null;
	const flip = (k: string) => set_toggled((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
	const rows = (nodes: Team_tree_node[], depth: number, path: string): ReactElement[] => nodes.map((n, i) => {
		const k = `${path}/${i}:${n.label}`;
		const open = (depth < OPEN_DEPTH) !== toggled.has(k);
		const to = n.cycle ? null : href(n);
		return (
			<li key={k} role="treeitem" aria-expanded={n.children.length ? open : undefined} aria-level={depth + 1} data-testid="structure-node" data-label={n.label}>
				<div className="flex min-w-0 items-center gap-1.5 py-0.5 text-[12.5px]" style={{ paddingLeft: depth * 18 }}>
					{n.children.length ? (
						<button type="button" aria-label={open ? `Fold ${n.label}` : `Open ${n.label}`} onClick={() => flip(k)} className="grid h-4 w-4 place-items-center text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">
							{open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
						</button>
					) : <span aria-hidden className="w-4 text-center text-[var(--g-line-strong)]">·</span>}
					{n.phase ? (
						depth === 0 && on_phase
							? <button type="button" onClick={() => on_phase(n.phase!)} className="g-mono text-[11.5px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)] hover:underline" title="Show this phase below">{n.phase}</button>
							: <span className="g-mono text-[11.5px] text-[var(--g-ink-3)]">{n.phase}</span>
					) : null}
					{n.phase ? <span aria-hidden className="text-[var(--g-ink-3)]">→</span> : null}
					{to ? <Link to={to} className="g-mono truncate font-semibold hover:underline">{n.label}</Link> : <span className="g-mono truncate font-semibold">{n.label}</span>}
					{n.version ? <span className="g-mono text-[11.5px] text-[var(--g-ink-3)]">v{n.version}</span> : null}
					{n.pinned ? <span className="rounded border border-[var(--g-line-2)] px-1 text-[10.5px] text-[var(--g-ink-3)]" title="The calling phase pins this version">pinned</span> : null}
					{n.may_call ? <span className="rounded border border-[var(--g-line-2)] px-1 text-[10.5px] text-[var(--g-ink-3)]" title="Run only for the items that name it">may call</span> : null}
					{n.cycle ? <span className="text-[11px] text-[var(--g-warn-text)]" title="Already above on this path: not opened again">↻ calls back up</span> : null}
				</div>
				{n.children.length && open ? <ul role="group">{rows(n.children, depth + 1, k)}</ul> : null}
			</li>
		);
	});
	return (
		<ul role="tree" aria-label={`Sub-teams of ${root.label}`} className="mt-2 max-w-[780px]" data-testid="team-structure">
			{rows(root.children, 0, '')}
		</ul>
	);
}
