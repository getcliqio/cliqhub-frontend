import { describe, it, expect } from 'vitest';
import { parse_team_yml_text } from '@/lib/team_yml_parse';
import type { GeneratedTeam } from '@/lib/builder/store';

const base_team: GeneratedTeam = {
	name: 'demo',
	description: 'old',
	phases: [{ name: 'a', type: 'standard', depends_on: [] }],
	roles: [{ name: 'a', content: 'role a' }],
	agents: [],
};

describe('parse_team_yml_text', () => {
	it('parses ordered top-level phases as the workflow', () => {
		const yaml = `
name: ignored
description: New desc
phases:
  - name: checkout
    type: standard
    agent: exec
    commands:
      - name: clone
        run: git clone .
  - name: build
    type: standard
    agent: cursor
    depends_on: [checkout]
`;
		const { team, error } = parse_team_yml_text(yaml, base_team);
		expect(error).toBeNull();
		expect(team.name).toBe('demo');
		expect(team.description).toBe('New desc');
		expect(team.phases.map((p) => p.name)).toEqual(['checkout', 'build']);
		expect(team.phases[0].commands?.[0].run).toBe('git clone .');
		expect(team.phases[1].depends_on).toEqual(['checkout']);
	});

	it('rejects nested workflow without top-level phases', () => {
		const yaml = `
name: demo
workflow:
  phases:
    - name: legacy
      type: standard
`;
		const { error } = parse_team_yml_text(yaml, base_team);
		expect(error).toMatch(/top-level phases/i);
	});

	it('requires phases array', () => {
		const { error } = parse_team_yml_text('name: demo\ndescription: x\n', base_team);
		expect(error).toMatch(/phases/i);
	});

	it('keeps matching roles and drops orphan roles', () => {
		const yaml = `
description: x
phases:
  - name: b
    type: standard
`;
		const existing = {
			...base_team,
			roles: [
				{ name: 'a', content: 'a' },
				{ name: 'b', content: 'b' },
			],
		};
		const { team, error } = parse_team_yml_text(yaml, existing);
		expect(error).toBeNull();
		expect(team.roles.map((r) => r.name)).toEqual(['b']);
	});
});
