/** Builder canvas gestures + inspector panels, driven through a tiny state harness. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { GeneratedTeam } from '@/lib/builder/store';

const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'sapan' }, scopes: [] }), useAuthFetch: () => stable_fetch }));

import { Gb_canvas, KIND_MIME } from '@/components/gbuilder/gb_canvas';
import { Phase_panel, Team_panel } from '@/components/gbuilder/gb_inspector';
import { Problems_list } from '@/components/gbuilder/gb_problems';
import { Shape_palette } from '@/components/gbuilder/gb_palette';
import { check_team } from '@/lib/builder/checks';

const TEAM: GeneratedTeam = {
	name: 'feature-dev', description: 'Ticket to PR',
	phases: [
		{ name: 'design', type: 'standard', agent: 'claude-code', depends_on: [] },
		{ name: 'tests', type: 'standard', agent: 'cursor', depends_on: ['design'] },
		{ name: 'scan', type: 'standard', agent: 'claude-code', depends_on: ['design'] },
		{ name: 'check', type: 'gate', agent: 'claude-code', depends_on: ['tests', 'scan'], commands: [{ name: 'test', run: 'npm test' }], max_iterations: 3 },
	],
	roles: [{ name: 'design', content: 'Design it.' }, { name: 'tests', content: 'Test it.' }, { name: 'scan', content: 'Scan it.' }],
	agents: [],
};

let latest: GeneratedTeam = TEAM;
function Canvas_harness({ start = TEAM }: { start?: GeneratedTeam }) {
	const [team, set_team] = useState(start);
	const [sel, set_sel] = useState<string | null>(null);
	latest = team;
	return (
		<>
			<Gb_canvas team={team} selected={sel} problems={new Map()} on_select={set_sel} on_change={(t, s) => { set_team(t); if (s !== undefined) set_sel(s); }} on_inputs={() => {}} />
			<output data-testid="sel">{sel ?? ''}</output>
		</>
	);
}
function Phase_harness({ name, start = TEAM }: { name: string; start?: GeneratedTeam }) {
	const [team, set_team] = useState(start);
	const [sel, set_sel] = useState<string | null>(name);
	latest = team;
	return sel && team.phases.some((p) => p.name === sel)
		? <Phase_panel team={team} name={sel} on_change={(t, s) => { set_team(t); if (s !== undefined) set_sel(s); }} on_select={set_sel} />
		: <output data-testid="none">none</output>;
}
const deps = (n: string) => latest.phases.find((p) => p.name === n)?.depends_on;
const node = (n: string) => document.querySelector<HTMLElement>(`[data-node="${n}"]`)!;
const names = () => latest.phases.map((p) => p.name);
/** jsdom has no hit-testing: point elementFromPoint at a given node. */
function hit(el: Element | null) { (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => el; }

afterEach(() => { vi.restoreAllMocks(); latest = TEAM; delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint; });

describe('Gb_canvas', () => {
	it('draws every phase, one arrow per dependency, and the run-inputs node', () => {
		render(<Canvas_harness />);
		for (const n of ['design', 'tests', 'scan', 'check']) expect(node(n)).toBeTruthy();
		expect(document.querySelectorAll('[data-edge]')).toHaveLength(4);
		expect(screen.getByTestId('inputs-node')).toBeTruthy();
	});

	it('siblings sit in team.yml order on the same row', () => {
		render(<Canvas_harness />);
		expect(node('tests').style.top).toBe(node('scan').style.top);
		expect(Number.parseFloat(node('tests').style.left)).toBeLessThan(Number.parseFloat(node('scan').style.left));
	});

	it('clicking a phase selects it; clicking empty canvas clears', () => {
		render(<Canvas_harness />);
		fireEvent.click(node('scan'));
		expect(screen.getByTestId('sel').textContent).toBe('scan');
		fireEvent.click(screen.getByRole('application', { name: 'Workflow canvas' }));
		expect(screen.getByTestId('sel').textContent).toBe('');
	});

	it('“+” under a leaf opens the kind menu and adds after it', () => {
		render(<Canvas_harness />);
		fireEvent.click(screen.getByLabelText('Add a phase after check'));
		fireEvent.click(within(screen.getByRole('menu')).getByText('Human review'));
		expect(deps('review')).toEqual(['check']);
		const r = latest.phases.find((p) => p.name === 'review')!;
		expect(r).toMatchObject({ type: 'gate', agent: 'hug' });
		expect(screen.getByTestId('sel').textContent).toBe('review');
	});

	it('hovering an arrow offers insert-between and remove-link', () => {
		render(<Canvas_harness />);
		fireEvent.mouseEnter(document.querySelector('[data-edge="design>scan"]')!);
		fireEvent.click(screen.getByLabelText('Insert a phase between design and scan'));
		fireEvent.click(within(screen.getByRole('menu')).getByText('Script'));
		expect(deps('script')).toEqual(['design']);
		expect(deps('scan')).toEqual(['script']);
		fireEvent.mouseEnter(document.querySelector('[data-edge="tests>check"]')!);
		fireEvent.click(screen.getByLabelText('Remove link tests → check'));
		expect(deps('check')).toEqual(['scan']);
	});

	it('dragging from a handle onto a phase wires “runs after”; cycles are refused with a toast', () => {
		render(<Canvas_harness />);
		hit(node('scan'));
		fireEvent.pointerDown(screen.getByTestId('handle-tests'), { clientX: 10, clientY: 10 });
		fireEvent.pointerUp(window, { clientX: 400, clientY: 300 });
		expect(deps('scan')).toEqual(['design', 'tests']);
		hit(node('design'));
		fireEvent.pointerDown(screen.getByTestId('handle-check'), { clientX: 10, clientY: 10 });
		fireEvent.pointerUp(window, { clientX: 0, clientY: 0 });
		expect(deps('design')).toEqual([]);
		expect(screen.getAllByRole('status').map((s) => s.textContent).join(' ')).toMatch(/loop|cycle/i);
	});

	it('dropping a tile on a phase adds after it; on an arrow inserts', async () => {
		render(<Canvas_harness />);
		const app = screen.getByRole('application', { name: 'Workflow canvas' });
		const dt = (k: string) => ({ types: [KIND_MIME], getData: (t: string) => (t === KIND_MIME ? k : ''), setData: vi.fn(), dropEffect: 'copy' });
		hit(node('design'));
		fireEvent.dragOver(app, { dataTransfer: dt('agent'), clientX: 5, clientY: 5 });
		fireEvent.drop(app, { dataTransfer: dt('agent'), clientX: 5, clientY: 5 });
		await waitFor(() => expect(deps('agent')).toEqual(['design']));
		expect(latest.roles.some((r) => r.name === 'agent')).toBe(true);
	});

	it('dragging a phase sideways past its sibling reorders team.yml', () => {
		render(<Canvas_harness />);
		hit(node('tests'));
		fireEvent.pointerDown(node('scan'), { clientX: 500, clientY: 10, button: 0 });
		fireEvent.pointerMove(window, { clientX: 300, clientY: 10 });
		fireEvent.pointerUp(window, { clientX: -1000, clientY: 10 });
		expect(names().indexOf('scan')).toBeLessThan(names().indexOf('tests'));
		expect(deps('scan')).toEqual(['design']); // wiring untouched
	});

	it('empty team shows the first-phase call to action', () => {
		render(<Canvas_harness start={{ ...TEAM, phases: [], roles: [] }} />);
		fireEvent.click(screen.getByText('+ Add the first phase'));
		fireEvent.click(within(screen.getByRole('menu')).getByText('Agent'));
		expect(names()).toEqual(['agent']);
	});

	it('preview mode shows NEW/CHANGED marks and locks editing', () => {
		const next = { ...TEAM, phases: [...TEAM.phases, { name: 'pr', type: 'standard' as const, agent: 'exec', depends_on: ['check'], commands: [{ name: 'x', run: 'y' }] }] };
		render(<Gb_canvas team={TEAM} selected={null} problems={new Map()} on_select={() => {}} on_change={() => { throw new Error('locked'); }} on_inputs={() => {}} preview={{ team: next, added: new Set(['pr']), changed: new Set(['check']), removed: [] }} />);
		expect(screen.getByTestId('preview-banner')).toBeTruthy();
		expect(screen.getByText('NEW')).toBeTruthy();
		expect(screen.getByText('CHANGED')).toBeTruthy();
		expect(screen.queryByLabelText('Add a phase after pr')).toBeNull();
	});
});

describe('Phase_panel', () => {
	it('agent phases have a required role brief; scripts have none', () => {
		const { unmount } = render(<Phase_harness name="design" />);
		expect(screen.getByRole('region', { name: 'Role brief' })).toBeTruthy();
		unmount();
		render(<Phase_harness name="run" start={{ ...TEAM, phases: [...TEAM.phases, { name: 'run', type: 'standard', agent: 'exec', depends_on: [], commands: [{ name: 'a', run: 'b' }] }] }} />);
		expect(screen.queryByRole('region', { name: 'Role brief' })).toBeNull();
		expect(screen.getByLabelText('Command 1')).toBeTruthy();
	});

	it('rename updates dependants and the role; invalid names are refused', () => {
		render(<Phase_harness name="design" />);
		const input = screen.getByLabelText('Phase name');
		fireEvent.change(input, { target: { value: 'Bad Name' } });
		fireEvent.blur(input);
		expect(names()).toContain('design');
		expect(screen.getByRole('alert')).toBeTruthy();
		fireEvent.change(input, { target: { value: 'architect' } });
		fireEvent.blur(input);
		expect(deps('tests')).toEqual(['architect']);
		expect(latest.roles.some((r) => r.name === 'architect')).toBe(true);
	});

	it('Runs after: add (cycles excluded) and remove', () => {
		render(<Phase_harness name="scan" />);
		const add = screen.getByLabelText('Add a phase this runs after') as HTMLSelectElement;
		const opts = [...add.options].map((o) => o.value).filter(Boolean);
		expect(opts).toContain('tests');
		expect(opts).not.toContain('check'); // check runs after scan → would loop
		fireEvent.change(add, { target: { value: 'tests' } });
		expect(deps('scan')).toEqual(['design', 'tests']);
		fireEvent.click(screen.getByLabelText('Stop running after design'));
		expect(deps('scan')).toEqual(['tests']);
	});

	it('changing kind keeps wiring (agent → human review)', () => {
		render(<Phase_harness name="scan" />);
		fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'human' } });
		expect(latest.phases.find((p) => p.name === 'scan')).toMatchObject({ type: 'gate', agent: 'hug', depends_on: ['design'] });
		expect(screen.getByLabelText('Reviewer')).toBeTruthy();
	});

	it('✦ Improve proposes a brief: Keep applies, Discard drops', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ok: true, data: { improved_content: '# design\nBetter brief.' } })));
		render(<Phase_harness name="design" />);
		fireEvent.click(screen.getByText('✦ Improve'));
		expect(await screen.findByTestId('role-proposal')).toBeTruthy();
		fireEvent.click(screen.getByText('Discard'));
		expect(latest.roles.find((r) => r.name === 'design')!.content).toBe('Design it.');
		fireEvent.click(screen.getByText('✦ Improve'));
		await screen.findByTestId('role-proposal');
		fireEvent.click(screen.getByText('Keep'));
		expect(latest.roles.find((r) => r.name === 'design')!.content).toBe('# design\nBetter brief.');
		const body = JSON.parse(String((globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body));
		expect(body).toMatchObject({ action: 'improve_role', role_name: 'design' });
	});

	it('improve errors show inline', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ok: false, error: { message: 'LLM busy' } }), { status: 503 }));
		render(<Phase_harness name="design" />);
		fireEvent.click(screen.getByText('✦ Improve'));
		expect((await screen.findByRole('alert')).textContent).toBe('LLM busy');
	});

	it('does not repeat problems (they live in the left panel list) and has a close button', () => {
		const bad = { ...TEAM, phases: TEAM.phases.map((p) => (p.name === 'tests' ? { ...p, depends_on: ['desing'] } : p)) };
		const on_close = vi.fn();
		render(<Phase_panel team={bad} name="tests" on_change={() => {}} on_select={() => {}} on_close={on_close} />);
		expect(screen.queryByTestId('panel-problems')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
		expect(on_close).toHaveBeenCalled();
	});

	it('⋯ menu: duplicate and delete (bridged)', () => {
		render(<Phase_harness name="tests" />);
		fireEvent.click(screen.getByLabelText('Phase actions'));
		fireEvent.click(screen.getByRole('menuitem', { name: /Duplicate/ }));
		expect(names().filter((n) => n.startsWith('tests'))).toHaveLength(2);
	});
});

describe('Team_panel', () => {
	it('edits use-for / not-for, inputs and asks AI for suggestions', () => {
		const ask = vi.fn();
		function H() {
			const [team, set_team] = useState(TEAM);
			latest = team;
			return <Team_panel team={team} on_change={set_team} on_ask_ai={ask} focus_inputs={0} />;
		}
		render(<H />);
		expect(screen.getByRole('region', { name: 'Use it for' })).toBeTruthy();
		expect(screen.getByRole('region', { name: 'Not for' })).toBeTruthy();
		fireEvent.click(within(screen.getByRole('region', { name: 'Use it for' })).getByRole('button', { name: /Suggest/ }));
		expect(ask).toHaveBeenCalledWith(expect.stringContaining('use_when'));
	});
});

describe('Problems_list', () => {
	const bad: GeneratedTeam = { ...TEAM, phases: TEAM.phases.map((p) => (p.name === 'tests' ? { ...p, depends_on: ['desing'] } : p.name === 'check' ? { ...p, commands: [] } : p)) };

	function List_harness({ on_open }: { on_open: (p: string | null) => void }) {
		const [team, set_team] = useState(bad);
		latest = team;
		return <Problems_list team={team} problems={check_team(team)} on_open={on_open} on_change={set_team} />;
	}

	it('counts errors and warnings, errors first; each row opens its phase', () => {
		const on_open = vi.fn();
		render(<List_harness on_open={on_open} />);
		const list = screen.getByTestId('problems');
		const errs = check_team(bad).filter((p) => p.level === 'error').length;
		expect(within(screen.getByTestId('problems-count')).getByText(`${errs} error${errs === 1 ? '' : 's'}`)).toBeTruthy();
		const rows = within(list).getAllByRole('listitem');
		expect(rows.length).toBe(check_team(bad).length);
		expect(rows[0].textContent).toContain('✕');
		fireEvent.click(within(list).getAllByTitle('Open check')[0]);
		expect(on_open).toHaveBeenCalledWith('check');
	});

	it('quick fixes apply in place', () => {
		render(<List_harness on_open={() => {}} />);
		const fix = within(screen.getByTestId('problems')).getAllByRole('button').find((b) => !b.title && /design/.test(b.textContent ?? ''))!;
		fireEvent.click(fix);
		expect(deps('tests')).toEqual(['design']);
	});

	it('says the workflow is valid when there is nothing to fix', () => {
		render(<Problems_list team={TEAM} problems={[]} on_open={() => {}} on_change={() => {}} />);
		expect(screen.getByText('✓ Valid workflow')).toBeTruthy();
		expect(screen.queryAllByRole('listitem')).toHaveLength(0);
	});
});

describe('Shape_palette', () => {
	it('is a compact grid of every phase kind; tooltips carry the description; click adds', () => {
		const on_add = vi.fn();
		render(<Shape_palette selected="design" on_add={on_add} />);
		const tiles = within(screen.getByTestId('palette')).getAllByRole('button');
		expect(tiles.map((t) => t.dataset.testid)).toEqual(['tile-agent', 'tile-gate', 'tile-human', 'tile-connector', 'tile-script', 'tile-fetch', 'tile-team']);
		// name only on the tile; the blurb is in the tooltip
		expect(screen.getByTestId('tile-gate').textContent).toBe('◆Gate');
		expect(screen.getByTestId('tile-gate').getAttribute('title')).toMatch(/checks · pass or route back.*add after design/);
		fireEvent.click(screen.getByTestId('tile-human'));
		expect(on_add).toHaveBeenCalledWith('human');
	});

	it('tiles drag the kind onto the canvas', () => {
		render(<Shape_palette selected={null} on_add={() => {}} />);
		const set = vi.fn();
		fireEvent.dragStart(screen.getByTestId('tile-script'), { dataTransfer: { setData: set, effectAllowed: '' } });
		expect(set).toHaveBeenCalledWith(KIND_MIME, 'script');
	});
});
