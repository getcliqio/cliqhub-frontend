/** Folding runs of script steps, and the one-line (left to right) layout. */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Workflow_graph } from '@/components/graphite/g_workflow_graph';
import { FOLD_PREFIX, fold_scripts, layout_phases, wrap_columns, type Team_phase } from '@/lib/team_page';

const step = (name: string, depends_on: string[], extra: Partial<Team_phase> = {}): Team_phase => ({
	name, type: 'standard', agent: 'exec', depends_on, review: false, reviewers: null, max_iterations: null,
	commands: [`./${name}.sh`], sources: [], targets: [], team: null, role: null, support: false, ...extra,
});
const gate = (name: string, on: string, max: number) => step(name, [on], { type: 'gate', agent: 'cursor', commands: [], max_iterations: max });

/** a → b → c → d (scripts), e (agent), f → g (scripts, inside g8's route-back), g8 (gate back to f), h → i (scripts). */
const team: Team_phase[] = [
	step('a', []), step('b', ['a']), step('c', ['b']), step('d', ['c']),
	step('e', ['d'], { agent: 'claude', commands: [] }),
	step('f', ['e']), step('g', ['f']), gate('g8', 'g', 2),
	step('h', ['g8']), step('i', ['h']),
];

describe('fold_scripts', () => {
	it('folds each run of two or more scripts, never inside a route-back; what followed a run depends on its fold', () => {
		const { phases, folds } = fold_scripts(team);
		expect(folds).toEqual({ [`${FOLD_PREFIX}a`]: ['a', 'b', 'c', 'd'], [`${FOLD_PREFIX}h`]: ['h', 'i'] });
		expect(phases.map((p) => p.name)).toEqual([`${FOLD_PREFIX}a`, 'e', 'f', 'g', 'g8', `${FOLD_PREFIX}h`]);
		expect(phases.find((p) => p.name === 'e')!.depends_on).toEqual([`${FOLD_PREFIX}a`]);
		expect(phases.find((p) => p.name === `${FOLD_PREFIX}h`)!.depends_on).toEqual(['g8']);
	});

	it('a kept step breaks its run; a branch is never folded across', () => {
		expect(fold_scripts(team, new Set(['b'])).folds).toEqual({ [`${FOLD_PREFIX}c`]: ['c', 'd'], [`${FOLD_PREFIX}h`]: ['h', 'i'] });
		const branchy = [step('a', []), step('b', ['a']), step('c', ['a'])];
		expect(fold_scripts(branchy).folds).toEqual({});
	});
});

describe('left to right', () => {
	it('keeps every step on one band, however long', () => {
		const long = Array.from({ length: 19 }, (_, i) => step(`s${i}`, i ? [`s${i - 1}`] : []));
		const L = layout_phases(long);
		expect(new Set(wrap_columns(L, L.cols).map((c) => c.band))).toEqual(new Set([0]));
		expect(new Set(wrap_columns(L).map((c) => c.band)).size).toBeGreaterThan(1);
	});

	it('draws a fold as one stacked node that opens on click', () => {
		const { phases, folds } = fold_scripts(team);
		const opened: string[] = [];
		const { container } = render(<Workflow_graph phases={phases} folds={folds} layout="row" on_unfold={(n) => opened.push(n)} />);
		const node = container.querySelector(`[data-phase="${FOLD_PREFIX}a"]`)!;
		expect(node.getAttribute('data-fold')).toBe('4');
		expect(node.textContent).toContain('+3 more scripts');
		(node as SVGGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(opened).toEqual([`${FOLD_PREFIX}a`]);
	});
});
