import { describe, it, expect } from 'vitest';

import {
	builder_reducer,
	INITIAL_STATE,
	type BuilderState,
	type GeneratedTeam,
	type GeneratedPhase,
	type GeneratedAgent,
	type BuilderAction,
} from '../src/lib/builder/store';


const SAMPLE_TEAM: GeneratedTeam = {
	name: 'test-team',
	description: 'A test team',
	phases: [
		{ name: 'architect', type: 'standard', depends_on: [] },
		{ name: 'developer', type: 'standard', depends_on: ['architect'] },
		{ name: 'reviewer', type: 'gate', depends_on: ['developer'], commands: [{ name: 'tests', run: 'npm test' }], max_iterations: 3 },
	],
	roles: [
		{ name: 'architect', content: 'Architect role content.' },
		{ name: 'developer', content: 'Developer role content.' },
		{ name: 'reviewer', content: 'Reviewer role content.' },
	],
	agents: [],
};

function with_team(overrides?: Partial<BuilderState>): BuilderState {
	return { ...INITIAL_STATE, team: structuredClone(SAMPLE_TEAM), view: 'canvas', ...overrides };
}


describe('builder_reducer — basic actions', () => {

	it('SET_VIEW changes view', () => {
		const state = builder_reducer(INITIAL_STATE, { type: 'SET_VIEW', view: 'canvas' });
		expect(state.view).toBe('canvas');
	});

	it('SET_GENERATING sets generating and clears error', () => {
		const initial = { ...INITIAL_STATE, error: 'old error' };
		const state = builder_reducer(initial, { type: 'SET_GENERATING', generating: true });
		expect(state.generating).toBe(true);
		expect(state.error).toBeNull();
	});

	it('SET_ERROR sets error and clears generating', () => {
		const initial = { ...INITIAL_STATE, generating: true };
		const state = builder_reducer(initial, { type: 'SET_ERROR', error: 'something broke' });
		expect(state.error).toBe('something broke');
		expect(state.generating).toBe(false);
	});

	it('SET_TEAM sets team, validation, switches to canvas without marking dirty', () => {
		const validation = { valid: true, errors: [], warnings: [] };
		const state = builder_reducer(INITIAL_STATE, { type: 'SET_TEAM', team: SAMPLE_TEAM, validation });
		expect(state.team?.name).toBe('test-team');
		expect(state.view).toBe('canvas');
		expect(state.generating).toBe(false);
		expect(state.dirty).toBe(false);
	});

	it('RESET returns to initial state', () => {
		const state = builder_reducer(with_team({ dirty: true }), { type: 'RESET' });
		expect(state).toEqual(INITIAL_STATE);
	});
});


describe('builder_reducer — selection', () => {

	it('SELECT_ROLE sets selected_role and clears selected_phase', () => {
		const initial = with_team({ selected_phase: 'architect' });
		const state = builder_reducer(initial, { type: 'SELECT_ROLE', name: 'developer' });
		expect(state.selected_role).toBe('developer');
		expect(state.selected_phase).toBeNull();
	});

	it('SELECT_PHASE sets selected_phase and clears selected_role', () => {
		const initial = with_team({ selected_role: 'developer' });
		const state = builder_reducer(initial, { type: 'SELECT_PHASE', name: 'architect' });
		expect(state.selected_phase).toBe('architect');
		expect(state.selected_role).toBeNull();
	});

	it('SELECT_ROLE with null deselects', () => {
		const initial = with_team({ selected_role: 'developer' });
		const state = builder_reducer(initial, { type: 'SELECT_ROLE', name: null });
		expect(state.selected_role).toBeNull();
	});

	it('SELECT_PHASE with null deselects', () => {
		const initial = with_team({ selected_phase: 'architect' });
		const state = builder_reducer(initial, { type: 'SELECT_PHASE', name: null });
		expect(state.selected_phase).toBeNull();
	});
});


describe('builder_reducer — role operations', () => {

	it('UPDATE_ROLE updates content of matching role', () => {
		const state = builder_reducer(with_team(), { type: 'UPDATE_ROLE', name: 'architect', content: 'New content' });
		const role = state.team!.roles.find(r => r.name === 'architect');
		expect(role?.content).toBe('New content');
		expect(state.dirty).toBe(true);
	});

	it('ADD_ROLE appends a new role', () => {
		const state = builder_reducer(with_team(), { type: 'ADD_ROLE', role: { name: 'tester', content: 'Tester content' } });
		expect(state.team!.roles).toHaveLength(4);
		expect(state.team!.roles[3].name).toBe('tester');
	});

	it('REMOVE_ROLE removes matching role', () => {
		const state = builder_reducer(with_team(), { type: 'REMOVE_ROLE', name: 'developer' });
		expect(state.team!.roles).toHaveLength(2);
		expect(state.team!.roles.some(r => r.name === 'developer')).toBe(false);
	});

	it('REMOVE_ROLE clears selected_role if it matches', () => {
		const initial = with_team({ selected_role: 'developer' });
		const state = builder_reducer(initial, { type: 'REMOVE_ROLE', name: 'developer' });
		expect(state.selected_role).toBeNull();
	});
});


describe('builder_reducer — phase operations', () => {

	it('ADD_PHASE appends a new phase', () => {
		const phase: GeneratedPhase = { name: 'tester', type: 'standard', depends_on: ['architect'] };
		const state = builder_reducer(with_team(), { type: 'ADD_PHASE', phase });
		expect(state.team!.phases).toHaveLength(4);
		expect(state.team!.phases[3].name).toBe('tester');
	});

	it('REMOVE_PHASE removes phase and cleans up dependencies', () => {
		const state = builder_reducer(with_team(), { type: 'REMOVE_PHASE', name: 'architect' });
		expect(state.team!.phases).toHaveLength(2);
		const developer = state.team!.phases.find(p => p.name === 'developer');
		expect(developer?.depends_on).toEqual([]);
	});

	it('REMOVE_PHASE removes associated role', () => {
		const state = builder_reducer(with_team(), { type: 'REMOVE_PHASE', name: 'architect' });
		expect(state.team!.roles.some(r => r.name === 'architect')).toBe(false);
	});

	it('REMOVE_PHASE clears selected_phase if it matches', () => {
		const initial = with_team({ selected_phase: 'architect' });
		const state = builder_reducer(initial, { type: 'REMOVE_PHASE', name: 'architect' });
		expect(state.selected_phase).toBeNull();
	});

	it('REMOVE_PHASE clears selected_role if it matches', () => {
		const initial = with_team({ selected_role: 'architect' });
		const state = builder_reducer(initial, { type: 'REMOVE_PHASE', name: 'architect' });
		expect(state.selected_role).toBeNull();
	});
});


describe('builder_reducer — UPDATE_PHASE preserves type', () => {

	it('preserves standard type when commands are added', () => {
		const state = builder_reducer(with_team(), {
			type: 'UPDATE_PHASE',
			phase: { name: 'architect', type: 'standard', depends_on: [], commands: [{ name: 'lint', run: 'npm run lint' }] },
		});
		const phase = state.team!.phases.find(p => p.name === 'architect');
		expect(phase?.type).toBe('standard');
	});

	it('preserves gate type when commands are removed', () => {
		const state = builder_reducer(with_team(), {
			type: 'UPDATE_PHASE',
			phase: { name: 'reviewer', type: 'gate', depends_on: ['developer'], commands: undefined, max_iterations: undefined },
		});
		const phase = state.team!.phases.find(p => p.name === 'reviewer');
		expect(phase?.type).toBe('gate');
	});

	it('preserves gate type when max_iterations removed', () => {
		const state = builder_reducer(with_team(), {
			type: 'UPDATE_PHASE',
			phase: { name: 'reviewer', type: 'gate', depends_on: ['developer'], commands: [{ name: 'tests', run: 'npm test' }], max_iterations: undefined },
		});
		const phase = state.team!.phases.find(p => p.name === 'reviewer');
		expect(phase?.type).toBe('gate');
	});

	it('preserves standard type with sources regardless of commands', () => {
		const initial = with_team();
		initial.team!.phases.push({ name: 'ingest', type: 'standard', depends_on: [], agent: 'connector', sources: [{ url: 'https://x.com', name: 'x' }] });

		const state = builder_reducer(initial, {
			type: 'UPDATE_PHASE',
			phase: { name: 'ingest', type: 'standard', depends_on: [], agent: 'connector', sources: [{ url: 'https://x.com', name: 'x' }], commands: [{ name: 'x', run: 'x' }] },
		});
		const phase = state.team!.phases.find(p => p.name === 'ingest');
		expect(phase?.type).toBe('standard');
	});

	it('preserves gate type when commands and max_iterations are added', () => {
		const initial = with_team();
		initial.team!.phases.push({ name: 'human-review', type: 'gate', depends_on: ['developer'], reviewer: 'senior-devs' });

		const state = builder_reducer(initial, {
			type: 'UPDATE_PHASE',
			phase: { name: 'human-review', type: 'gate', depends_on: ['developer'], commands: [{ name: 'tests', run: 'npm test' }], max_iterations: 2, reviewer: 'senior-devs' },
		});
		const phase = state.team!.phases.find(p => p.name === 'human-review');
		expect(phase?.type).toBe('gate');
	});

	it('preserves flat review fields on gate phase update', () => {
		const initial = with_team();
		initial.team!.phases.push({ name: 'human-review', type: 'gate', depends_on: [], reviewer: 'architects', artifacts: ['src/'], timeout: '2h', remind_every: '30m' });

		const state = builder_reducer(initial, {
			type: 'UPDATE_PHASE',
			phase: { name: 'human-review', type: 'gate', depends_on: [], reviewer: 'architects', artifacts: ['src/', 'docs/'], timeout: '1h' },
		});
		const phase = state.team!.phases.find(p => p.name === 'human-review');
		expect(phase?.reviewer).toBe('architects');
		expect(phase?.artifacts).toEqual(['src/', 'docs/']);
		expect(phase?.timeout).toBe('1h');
		expect(phase?.remind_every).toBe('30m');
	});
});


describe('builder_reducer — dependency operations', () => {

	it('ADD_DEPENDENCY adds dependency to target phase', () => {
		const state = builder_reducer(with_team(), {
			type: 'ADD_DEPENDENCY',
			phase: 'architect',
			dependency: 'developer',
		});
		const architect = state.team!.phases.find(p => p.name === 'architect');
		expect(architect?.depends_on).toContain('developer');
	});

	it('ADD_DEPENDENCY does not add duplicate', () => {
		const state = builder_reducer(with_team(), {
			type: 'ADD_DEPENDENCY',
			phase: 'developer',
			dependency: 'architect',
		});
		const developer = state.team!.phases.find(p => p.name === 'developer');
		expect(developer?.depends_on.filter(d => d === 'architect')).toHaveLength(1);
	});

	it('REMOVE_DEPENDENCY removes dependency from target phase', () => {
		const state = builder_reducer(with_team(), {
			type: 'REMOVE_DEPENDENCY',
			phase: 'developer',
			dependency: 'architect',
		});
		const developer = state.team!.phases.find(p => p.name === 'developer');
		expect(developer?.depends_on).not.toContain('architect');
	});

	it('REMOVE_DEPENDENCY is a no-op for non-existent dependency', () => {
		const state = builder_reducer(with_team(), {
			type: 'REMOVE_DEPENDENCY',
			phase: 'architect',
			dependency: 'nonexistent',
		});
		const architect = state.team!.phases.find(p => p.name === 'architect');
		expect(architect?.depends_on).toEqual([]);
	});
});


describe('builder_reducer — draft operations', () => {

	it('SET_DRAFT_ID stores draft id and clears dirty', () => {
		const initial = with_team({ dirty: true });
		const state = builder_reducer(initial, { type: 'SET_DRAFT_ID', draft_id: 42 });
		expect(state.draft_id).toBe(42);
		expect(state.dirty).toBe(false);
	});

	it('LOAD_DRAFT sets team, draft_id, switches to canvas', () => {
		const state = builder_reducer(INITIAL_STATE, { type: 'LOAD_DRAFT', team: SAMPLE_TEAM, draft_id: 7 });
		expect(state.team?.name).toBe('test-team');
		expect(state.draft_id).toBe(7);
		expect(state.view).toBe('canvas');
		expect(state.dirty).toBe(false);
	});
});


describe('builder_reducer — agent operations', () => {

	it('ADD_AGENT appends an agent', () => {
		const agent: GeneratedAgent = { name: 'my-agent', entry: 'agents/my-agent/index.js' };
		const state = builder_reducer(with_team(), { type: 'ADD_AGENT', agent });
		expect(state.team!.agents).toHaveLength(1);
		expect(state.team!.agents[0].name).toBe('my-agent');
		expect(state.dirty).toBe(true);
	});

	it('REMOVE_AGENT removes matching agent and clears phase references', () => {
		const agent: GeneratedAgent = { name: 'my-agent' };
		const initial = with_team();
		initial.team!.agents = [agent];
		initial.team!.phases[0].agent = 'my-agent';

		const state = builder_reducer(initial, { type: 'REMOVE_AGENT', name: 'my-agent' });
		expect(state.team!.agents).toHaveLength(0);
		expect(state.team!.phases[0].agent).toBeUndefined();
	});

	it('REMOVE_AGENT clears selected_agent if it matches', () => {
		const agent: GeneratedAgent = { name: 'my-agent' };
		const initial = with_team({ selected_agent: 'my-agent' });
		initial.team!.agents = [agent];

		const state = builder_reducer(initial, { type: 'REMOVE_AGENT', name: 'my-agent' });
		expect(state.selected_agent).toBeNull();
	});

	it('UPDATE_AGENT updates matching agent', () => {
		const agent: GeneratedAgent = { name: 'my-agent', entry: 'agents/old/index.js' };
		const initial = with_team();
		initial.team!.agents = [agent];

		const updated: GeneratedAgent = { name: 'my-agent', entry: 'agents/new/index.js' };
		const state = builder_reducer(initial, { type: 'UPDATE_AGENT', agent: updated });
		expect(state.team!.agents[0].entry).toBe('agents/new/index.js');
	});

	it('SELECT_AGENT sets selected_agent and clears phase/role', () => {
		const initial = with_team({ selected_phase: 'architect', selected_role: 'developer' });
		const state = builder_reducer(initial, { type: 'SELECT_AGENT', name: 'my-agent' });
		expect(state.selected_agent).toBe('my-agent');
		expect(state.selected_phase).toBeNull();
		expect(state.selected_role).toBeNull();
	});

	it('SELECT_ROLE clears selected_agent', () => {
		const initial = with_team({ selected_agent: 'my-agent' });
		const state = builder_reducer(initial, { type: 'SELECT_ROLE', name: 'architect' });
		expect(state.selected_agent).toBeNull();
	});

	it('SELECT_PHASE clears selected_agent', () => {
		const initial = with_team({ selected_agent: 'my-agent' });
		const state = builder_reducer(initial, { type: 'SELECT_PHASE', name: 'architect' });
		expect(state.selected_agent).toBeNull();
	});

	it('ADD_AGENT is a no-op without team', () => {
		const agent: GeneratedAgent = { name: 'my-agent' };
		const state = builder_reducer(INITIAL_STATE, { type: 'ADD_AGENT', agent });
		expect(state).toEqual(INITIAL_STATE);
	});

	it('SET_TEAM defaults agents to empty array when missing', () => {
		const team_no_agents = { ...SAMPLE_TEAM } as any;
		delete team_no_agents.agents;
		const state = builder_reducer(INITIAL_STATE, { type: 'SET_TEAM', team: team_no_agents, validation: null });
		expect(state.team!.agents).toEqual([]);
	});
});


describe('builder_reducer — sources/target_entries operations', () => {

	it('UPDATE_PHASE adds sources entries', () => {
		const state = builder_reducer(with_team(), {
			type: 'UPDATE_PHASE',
			phase: {
				name: 'architect',
				type: 'standard',
				depends_on: [],
				sources: [{ name: 'spec', url: 'https://example.com/spec' }],
			},
		});
		const phase = state.team!.phases.find(p => p.name === 'architect');
		expect(phase?.sources).toHaveLength(1);
		expect(phase?.sources![0].url).toBe('https://example.com/spec');
		expect(phase?.sources![0].name).toBe('spec');
	});

	it('UPDATE_PHASE adds target_entries', () => {
		const state = builder_reducer(with_team(), {
			type: 'UPDATE_PHASE',
			phase: {
				name: 'developer',
				type: 'standard',
				depends_on: ['architect'],
				target_entries: [{ name: 'report', file: 'output/report.md', url: 'gdoc://abc', mode: 'create' }],
			},
		});
		const phase = state.team!.phases.find(p => p.name === 'developer');
		expect(phase?.target_entries).toHaveLength(1);
		expect(phase?.target_entries![0].file).toBe('output/report.md');
		expect(phase?.target_entries![0].mode).toBe('create');
	});

	it('UPDATE_PHASE removes sources by setting undefined', () => {
		const initial = with_team();
		initial.team!.phases[0].sources = [{ name: 'data', url: 'https://example.com' }];

		const state = builder_reducer(initial, {
			type: 'UPDATE_PHASE',
			phase: { name: 'architect', type: 'standard', depends_on: [], sources: undefined },
		});
		const phase = state.team!.phases.find(p => p.name === 'architect');
		expect(phase?.sources).toBeUndefined();
	});

	it('UPDATE_PHASE removes target_entries by setting undefined', () => {
		const initial = with_team();
		initial.team!.phases[1].target_entries = [{ name: 'output', file: 'out.md', url: 'gdoc://x' }];

		const state = builder_reducer(initial, {
			type: 'UPDATE_PHASE',
			phase: { name: 'developer', type: 'standard', depends_on: ['architect'], target_entries: undefined },
		});
		const phase = state.team!.phases.find(p => p.name === 'developer');
		expect(phase?.target_entries).toBeUndefined();
	});

	it('ADD_PHASE with sources/target_entries preserves them', () => {
		const phase: GeneratedPhase = {
			name: 'ingest',
			type: 'standard',
			depends_on: [],
			sources: [{ name: 'raw-data', url: 'https://data.example.com' }],
			target_entries: [{ name: 'processed', file: 'processed.md', url: 'gdrive://folder', mode: 'append' }],
		};
		const state = builder_reducer(with_team(), { type: 'ADD_PHASE', phase });
		const added = state.team!.phases.find(p => p.name === 'ingest');
		expect(added?.sources).toHaveLength(1);
		expect(added?.sources![0].name).toBe('raw-data');
		expect(added?.target_entries).toHaveLength(1);
	});

	it('REMOVE_PHASE removes phase with sources/target_entries cleanly', () => {
		const initial = with_team();
		initial.team!.phases[0].sources = [{ name: 'data', url: 'https://example.com' }];
		initial.team!.phases[0].target_entries = [{ name: 'output', file: 'out.md', url: 'gdoc://x' }];

		const state = builder_reducer(initial, { type: 'REMOVE_PHASE', name: 'architect' });
		expect(state.team!.phases.find(p => p.name === 'architect')).toBeUndefined();
	});
});


describe('builder_reducer — no team guard', () => {

	it('UPDATE_ROLE is a no-op without team', () => {
		const state = builder_reducer(INITIAL_STATE, { type: 'UPDATE_ROLE', name: 'x', content: 'y' });
		expect(state).toEqual(INITIAL_STATE);
	});

	it('ADD_PHASE is a no-op without team', () => {
		const phase: GeneratedPhase = { name: 'x', type: 'standard', depends_on: [] };
		const state = builder_reducer(INITIAL_STATE, { type: 'ADD_PHASE', phase });
		expect(state).toEqual(INITIAL_STATE);
	});

	it('REMOVE_PHASE is a no-op without team', () => {
		const state = builder_reducer(INITIAL_STATE, { type: 'REMOVE_PHASE', name: 'x' });
		expect(state).toEqual(INITIAL_STATE);
	});

	it('ADD_DEPENDENCY is a no-op without team', () => {
		const state = builder_reducer(INITIAL_STATE, { type: 'ADD_DEPENDENCY', phase: 'a', dependency: 'b' });
		expect(state).toEqual(INITIAL_STATE);
	});
});
