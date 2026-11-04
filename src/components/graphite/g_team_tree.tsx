/**
 * Teams as a tree (PLAN-team-bundle S9): the top-level teams as rows, each opening into the sub-teams it calls,
 * nested, with the version used — pinned, or the latest (on a realm: what's installed). A team used by more than
 * one listed team says so; a dynamic map's allowed teams are "may call"; a cycle is shown once. Built by the BFF.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Team_tree_node } from '@/lib/team_page';

/** A node's key in the fold state: its path of labels. */
const key_of = (path: string[]) => path.join('>');

/** The tree, every level open; a level folds from its chevron. */
export function Team_tree({ nodes, href, empty = 'No teams.' }: {
	nodes: Team_tree_node[];
	/** The page a team's row opens (`@scope/slug`), or null when it has none. */
	href: (label: string) => string | null;
	empty?: string;
}) {
	const [folded, set_folded] = useState<Set<string>>(() => new Set());
	const toggle = (k: string) => set_folded((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
	if (!nodes.length) return <p className="px-4 py-12 text-center text-[13px] text-[var(--g-ink-3)]">{empty}</p>;
	return (
		<ul role="tree" aria-label="Teams as a tree" className="flex flex-col py-1.5">
			{nodes.map((n) => <Tree_row key={n.label} node={n} path={[n.label]} depth={0} folded={folded} toggle={toggle} href={href} />)}
		</ul>
	);
}

function Tree_row({ node, path, depth, folded, toggle, href }: {
	node: Team_tree_node;
	path: string[];
	depth: number;
	folded: Set<string>;
	toggle: (k: string) => void;
	href: (label: string) => string | null;
}) {
	const k = key_of(path);
	const open = !folded.has(k);
	const has_children = node.children.length > 0;
	const to = href(node.label);
	const [scope, name] = node.label.replace(/^@/, '').split('/');
	return (
		<li role="treeitem" aria-expanded={has_children ? open : undefined} aria-level={depth + 1} data-testid={`tree-${k}`}>
			<div className="flex flex-wrap items-center gap-2 px-4 py-1.5 text-[12.5px] hover:bg-[var(--g-soft)]" style={{ paddingLeft: `${16 + depth * 22}px` }}>
				{has_children ? (
					<button type="button" aria-label={`${open ? 'Fold' : 'Open'} ${node.label}`} onClick={() => toggle(k)} className="grid h-5 w-5 place-items-center rounded text-[var(--g-ink-3)] hover:bg-[var(--g-line)]">
						{open ? <ChevronDown aria-hidden className="h-3.5 w-3.5" /> : <ChevronRight aria-hidden className="h-3.5 w-3.5" />}
					</button>
				) : <span className="w-5" aria-hidden />}
				{to ? (
					<Link to={to} className={`${depth ? '' : 'font-semibold'} text-[var(--g-ink)] hover:underline`}>{name ?? node.label}</Link>
				) : <span className={depth ? '' : 'font-semibold'}>{name ?? node.label}</span>}
				{scope && name ? <span className="g-mono text-[11px] text-[var(--g-ink-3)]">@{scope}</span> : null}
				<span className="g-mono text-[11.5px] text-[var(--g-ink-2,var(--g-ink-3))]" data-testid="tree-version">
					{node.version ?? '—'}
					{depth && !node.pinned && node.version ? <span className="ml-1 font-sans text-[10.5px] text-[var(--g-ink-3)]">latest</span> : null}
					{node.pinned ? <span className="ml-1 font-sans text-[10.5px] text-[var(--g-ink-3)]">pinned</span> : null}
				</span>
				{node.used_by > 1 ? <span className="rounded bg-[var(--g-soft)] px-1.5 py-px text-[10.5px] text-[var(--g-ink-3)]" data-testid="tree-used-by">used by {node.used_by}</span> : null}
				{node.may_call ? <span className="rounded border border-dashed border-[var(--g-line)] px-1.5 py-px text-[10.5px] text-[var(--g-ink-3)]">may call</span> : null}
				{node.cycle ? <span className="text-[10.5px] text-[var(--g-warn-text,var(--g-ink-3))]" title="Already on the path above">↻ calls back up</span> : null}
			</div>
			{has_children && open ? (
				<ul role="group" className="flex flex-col">
					{node.children.map((c, i) => <Tree_row key={`${c.label}-${i}`} node={c} path={[...path, `${c.label}#${i}`]} depth={depth + 1} folded={folded} toggle={toggle} href={href} />)}
				</ul>
			) : null}
		</li>
	);
}

/** Tree or flat (S9): the tree shows how teams fit together; the flat list pages and has the row actions. */
export function View_switch({ view, on_change }: { view: 'tree' | 'flat'; on_change: (v: 'tree' | 'flat') => void }) {
	const btn = (v: 'tree' | 'flat', label: string) => (
		<button type="button" aria-pressed={view === v} onClick={() => on_change(v)}
			className={`rounded-md px-2.5 py-1 text-[12px] ${view === v ? 'bg-[var(--g-panel)] font-semibold text-[var(--g-ink)] shadow-sm' : 'text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>{label}</button>
	);
	return (
		<div role="group" aria-label="View" className="flex w-fit gap-0.5 self-end rounded-lg bg-[var(--g-soft)] p-0.5">
			{btn('flat', 'Flat')}{btn('tree', 'Tree')}
		</div>
	);
}

/** The flat view's Uses · Used by: the teams a team calls, and the listed teams calling it (S9). */
export function Uses_cell({ uses, used_by }: { uses?: string[]; used_by?: string[] }) {
	if (!uses?.length && !used_by?.length) return <span className="text-[12px] text-[var(--g-ink-3)]">—</span>;
	return (
		<span className="flex flex-col gap-0.5 text-[11.5px]" data-testid="uses-cell">
			{uses?.length ? <span><span className="text-[var(--g-ink-3)]">uses </span><span className="g-mono">{uses.join(', ')}</span></span> : null}
			{used_by?.length ? <span><span className="text-[var(--g-ink-3)]">used by </span><span className="g-mono">{used_by.join(', ')}</span></span> : null}
		</span>
	);
}
