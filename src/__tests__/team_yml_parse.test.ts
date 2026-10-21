import { describe, it, expect } from 'vitest';
import { parse_team_yml_text } from '@/lib/team_yml_parse';
import type { GeneratedTeam } from '@/lib/builder/store';
import yaml from 'js-yaml';
import { build_team_yml } from '@/lib/team_export';
import { builder_team_from_detail } from '@/lib/team_builder';

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

describe('HUG gate review block (builder ↔ daemon)', () => {
	it('exports reviewer groups + artifacts the daemon accepts, and reads them back', async () => {
		const { build_team_yml } = await import('@/lib/team_export');
		const yml = build_team_yml({
			name: 'demo', description: 'd', roles: [],
			phases: [
				{ name: 'build', type: 'standard', agent: 'cursor', depends_on: [] },
				{ name: 'approve', type: 'gate', agent: 'hug', depends_on: ['build'], review: { reviewer: ['elan', 'ops'], artifacts: ['.cliq/design/*.md'], timeout: '60' } },
			],
		} as never);
		const review = (yaml.load(yml) as { phases: Array<{ review?: Record<string, unknown> }> }).phases[1].review;
		expect(review).toEqual({ reviewers: [{ policy: 'any', channels: ['elan', 'ops'] }], artifacts: ['.cliq/design/*.md'], timeout: '60' });

		const { team } = parse_team_yml_text(yml, base_team);
		expect(team?.phases[1]?.review).toMatchObject({ reviewer: 'elan, ops', artifacts: ['.cliq/design/*.md'] });
	});

	it('still reads a legacy `reviewer:` and a single-channel group', () => {
		const legacy = parse_team_yml_text('name: x\nphases:\n  - name: g\n    type: gate\n    agent: hug\n    review:\n      reviewer: elan\n', base_team);
		expect(legacy.team?.phases[0]?.review?.reviewer).toBe('elan');
		const group = parse_team_yml_text('name: x\nphases:\n  - name: g\n    type: gate\n    agent: hug\n    review:\n      reviewers:\n        - policy: any\n          channels: [elan]\n', base_team);
		expect(group.team?.phases[0]?.review?.reviewer).toBe('elan');
	});
});

describe('a team phase passes values to its sub-team in `args`', () => {
	const phase = (team: GeneratedTeam | undefined) => team?.phases.find((p) => p.name === 'sync');

	it.each(['args'])('reads `%s`', (key) => {
		const yaml = `name: x\ndescription: d\nphases:\n  - name: sync\n    type: team\n    team: "@m/git-sync"\n    ${key}:\n      mode: "ensure"\n      index: "false"\n`;
		const { team, error } = parse_team_yml_text(yaml, base_team);
		expect(error).toBeFalsy();
		expect(phase(team)?.inputs).toEqual({ mode: 'ensure', index: 'false' });
	});

	it('writes `args` (the daemon reads nothing else)', () => {
		const { team } = parse_team_yml_text('name: x\ndescription: d\nphases:\n  - name: sync\n    type: team\n    team: "@m/git-sync"\n    args:\n      mode: "ensure"\n', base_team);
		const out = build_team_yml({ ...team!, agents: [] });
		const sync = (yaml.load(out) as { phases: Array<Record<string, unknown>> }).phases[0];
		expect(sync.args).toEqual({ mode: 'ensure' });
		expect(sync).not.toHaveProperty('inputs');
		expect(sync).not.toHaveProperty('team_inputs');
	});
});


describe('the builder keeps team.yml: nothing it doesn\'t edit is lost', () => {
	// The shape of @measureone/architect: a jira action, sub-teams with args, an unnamed multi-line
	// command with escalate_on_fail, a timeout, outputs and required inputs — and comments.
	const ARCHITECT = `name: "@measureone/architect"
version: "0.1.29"
description: "One run"
tags: [architect, lld]
inputs:
  - name: jira_key
    description: "Epic or story key"
    required: true
  - name: create_stories
    required: false
    default: "false"
outputs:
  - name: dispatch
    description: "dispatch.json jobs"
phases:
  - name: fetch
    type: standard
    agent: jira
    action: get_issue_tree
    sources:
      - name: ticket.json
        ref: "{{inputs.jira_key}}"

  - name: ensure-clones
    type: team
    team: "@measureone/git-sync"
    depends_on: [fetch]
    args:
      mode: "ensure"
      index: "false"

  # create_issue hardcodes issuetype Story
  - name: create-stories
    type: standard
    agent: exec
    depends_on: [ensure-clones]
    timeout: -1
    commands:
      - escalate_on_fail: true
        run: |
          set -e
          python3 "$SRC/create_stories.py"
`;
	const detail = { name: 'architect', scope: 'measureone', description: 'One run', raw_manifest: ARCHITECT, roles: [], workflow: { phases: [] } };
	const open = () => builder_team_from_detail(detail, { label: '@measureone/architect', version: '0.1.29' })!;

	it('opens a published team from its team.yml: the action, sub-team and args are there', () => {
		const t = open();
		expect(t.phases.find((p) => p.name === 'fetch')).toMatchObject({ agent: 'jira', action: 'get_issue_tree' });
		expect(t.phases.find((p) => p.name === 'ensure-clones')).toMatchObject({ type: 'team', team: '@measureone/git-sync', inputs: { mode: 'ensure', index: 'false' } });
	});

	it('saved without changes, team.yml is exactly what was opened (comments too)', () => {
		expect(build_team_yml(open())).toBe(ARCHITECT);
	});

	it('an edit changes only that field; everything else is kept as written', () => {
		const t = open();
		const edited = { ...t, description: 'One run, edited', phases: t.phases.map((p) => (p.name === 'fetch' ? { ...p, action: 'get_issue' } : p)) };
		const doc = yaml.load(build_team_yml(edited)) as Record<string, any>;
		const before = yaml.load(ARCHITECT) as Record<string, any>;
		expect(doc.description).toBe('One run, edited');
		expect(doc.phases[0].action).toBe('get_issue');
		expect({ ...doc, description: before.description, phases: doc.phases.map((p: any) => (p.name === 'fetch' ? { ...p, action: 'get_issue_tree' } : p)) }).toEqual(before);
		expect(doc.phases[2].commands[0]).toEqual({ escalate_on_fail: true, run: 'set -e\npython3 "$SRC/create_stories.py"\n' });
		expect(doc.phases[2].timeout).toBe(-1);
		expect(doc.inputs[0].required).toBe(true);
		expect(doc.outputs).toEqual(before.outputs);
	});

	it('editing a sub-team value keeps the others; a new phase is written in full', () => {
		const t = open();
		const edited = {
			...t,
			phases: [
				...t.phases.map((p) => (p.name === 'ensure-clones' ? { ...p, inputs: { ...p.inputs, mode: 'full' } } : p)),
				{ name: 'notify', type: 'standard' as const, agent: 'exec', depends_on: ['create-stories'], commands: [{ name: 'say', run: 'echo done' }] },
			],
		};
		const doc = yaml.load(build_team_yml(edited)) as Record<string, any>;
		expect(doc.phases[1].args).toEqual({ mode: 'full', index: 'false' });
		expect(doc.phases[3]).toEqual({ name: 'notify', type: 'standard', agent: 'exec', depends_on: ['create-stories'], commands: [{ name: 'say', run: 'echo done' }] });
	});
});
