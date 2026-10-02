/** Builder pure logic: kinds, graph edits, layout rule, checks, YAML tools, publish. */
import { describe, it, expect } from 'vitest';
import type { GeneratedPhase, GeneratedTeam } from '@/lib/builder/store';
import { kind_of, new_phase, role_need, unique_name, is_llm_agent, default_llm_agent } from '@/lib/builder/kinds';
import {
	add_after, add_root, builder_layout, change_kind, connect, diff_teams, disconnect, duplicate_phase,
	insert_between, move_within_step, release_notes, remove_bridged, rename_phase, steps_of, would_cycle,
} from '@/lib/builder/graph_ops';
import { check_team, closest, find_cycle } from '@/lib/builder/checks';
import { error_position, format_yaml, has_comments, parse_yaml, phase_at_line, phase_ranges, problem_line, team_to_yaml } from '@/lib/builder/yaml_tools';
import { next_version, publish_body, suggest_bump, team_scope, team_slug } from '@/lib/builder/publish';
import { builder_team_from_saved } from '@/lib/team_builder';

const P = (name: string, over: Partial<GeneratedPhase> = {}): GeneratedPhase => ({ name, type: 'standard', agent: 'claude-code', depends_on: [], ...over });
function team(over: Partial<GeneratedTeam> = {}): GeneratedTeam {
	return {
		name: '@acme/feature-dev', description: 'Ticket to PR', version: '1.0.0',
		inputs: [{ name: 'ticket', description: 'Jira key' }],
		phases: [
			P('fetch', { agent: 'jira', action: 'get_issue', sources: [{ name: 'ticket', url: 'jira://$(inputs.ticket)' }] }),
			P('architect', { depends_on: ['fetch'] }),
			P('tests', { depends_on: ['architect'], agent: 'cursor' }),
			P('scan', { depends_on: ['architect'] }),
			P('implement', { depends_on: ['tests'] }),
			P('check', { type: 'gate', depends_on: ['implement', 'scan'], commands: [{ name: 'test', run: 'npm test' }], max_iterations: 3 }),
			P('git-resolver', { is_support: true }),
		],
		roles: ['architect', 'tests', 'scan', 'implement', 'git-resolver'].map((n) => ({ name: n, content: `# ${n}\n\nYou are the ${n}. Produce the artifacts this step owns and nothing else.` })),
		agents: [],
		...over,
	};
}
const names = (t: GeneratedTeam) => t.phases.map((p) => p.name);
const deps = (t: GeneratedTeam, n: string) => t.phases.find((p) => p.name === n)!.depends_on;
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }>; };

describe('kinds', () => {
	it('maps type + agent to the kind people think in', () => {
		expect(kind_of({ type: 'standard', agent: 'claude-code' })).toBe('agent');
		expect(kind_of({ type: 'standard', agent: undefined })).toBe('agent');
		expect(kind_of({ type: 'standard', agent: 'exec' })).toBe('script');
		expect(kind_of({ type: 'standard', agent: 'curl' })).toBe('fetch');
		expect(kind_of({ type: 'standard', agent: 'gdrive' })).toBe('connector');
		expect(kind_of({ type: 'gate', agent: 'claude-code' })).toBe('gate');
		expect(kind_of({ type: 'gate', agent: 'hug' })).toBe('human');
		expect(kind_of({ type: 'team', agent: undefined })).toBe('team');
	});
	it('role brief only where the kind has one', () => {
		expect(role_need(P('a'))).toBe('required');
		expect(role_need(P('a', { agent: 'exec' }))).toBe('none');
		expect(role_need(P('a', { agent: 'jira' }))).toBe('none');
		expect(role_need(P('a', { agent: 'curl' }))).toBe('none');
		expect(role_need(P('a', { type: 'gate' }))).toBe('optional');
		expect(role_need(P('a', { type: 'gate', agent: 'hug' }))).toBe('optional');
		expect(role_need(P('a', { type: 'team', agent: undefined }))).toBe('optional');
	});
	it('new phases get defaults and unique names', () => {
		const t = team();
		expect(unique_name('check', names(t))).toBe('check-2');
		expect(unique_name('New Phase!', [])).toBe('new-phase');
		expect(new_phase('human', t)).toMatchObject({ type: 'gate', agent: 'hug', review: { reviewer: '' } });
		expect(new_phase('gate', t)).toMatchObject({ name: 'check-2', type: 'gate', agent: 'claude-code', max_iterations: 3 });
		expect(new_phase('script', t)).toMatchObject({ agent: 'exec', commands: [{ name: 'run', run: '' }] });
		expect(new_phase('team', t)).toMatchObject({ type: 'team', team: '' });
		expect(default_llm_agent({ ...t, phases: [P('x', { agent: 'cursor' })] })).toBe('cursor');
		expect(is_llm_agent('hug')).toBe(false);
		expect(is_llm_agent('my-agent', { agents: [{ name: 'my-agent' }] })).toBe(true);
	});
});

describe('layout: step from depends_on, team.yml order within a step', () => {
	it('steps and slots', () => {
		const L = builder_layout(team());
		expect(L.pos.get('fetch')).toMatchObject({ step: 0, slot: 0 });
		expect(L.pos.get('tests')).toMatchObject({ step: 2, slot: -0.5 });
		expect(L.pos.get('scan')).toMatchObject({ step: 2, slot: 0.5 });
		expect(L.pos.get('check')!.step).toBe(4);
		expect(L.steps).toBe(5);
		expect(L.support).toEqual(['git-resolver']);
		expect(L.pos.has('git-resolver')).toBe(false);
	});
	it('reordering within a step changes file order, and so the layout', () => {
		const t = ok(move_within_step(team(), 'scan', 'tests', 'before')).team;
		expect(names(t).indexOf('scan')).toBeLessThan(names(t).indexOf('tests'));
		expect(builder_layout(t).pos.get('scan')!.slot).toBe(-0.5);
		expect(move_within_step(team(), 'check', 'tests', 'before').ok).toBe(false);
		expect(ok(move_within_step(team(), 'tests', 'tests', 'after')).team).toEqual(team());
	});
	it('loads the same every time (deterministic)', () => {
		expect([...builder_layout(team()).pos]).toEqual([...builder_layout(structuredClone(team())).pos]);
	});
});

describe('graph edits', () => {
	it('connect / disconnect with loop and duplicate protection', () => {
		const t = ok(connect(team(), 'fetch', 'implement')).team;
		expect(deps(t, 'implement')).toEqual(['tests', 'fetch']);
		expect(connect(t, 'fetch', 'implement')).toMatchObject({ ok: false });
		expect(connect(team(), 'check', 'fetch')).toMatchObject({ ok: false, error: expect.stringMatching(/loop/) });
		expect(connect(team(), 'fetch', 'fetch').ok).toBe(false);
		expect(connect(team(), 'git-resolver', 'check').ok).toBe(false);
		expect(would_cycle(team(), 'implement', 'tests')).toBe(true);
		expect(deps(ok(disconnect(team(), 'scan', 'check')).team, 'check')).toEqual(['implement']);
		expect(disconnect(team(), 'fetch', 'check').ok).toBe(false);
	});
	it('insert on an arrow rewires both ends and sits between them in the file', () => {
		const r = ok(insert_between(team(), 'gate', 'implement', 'check'));
		expect(r.name).toBe('check-2');
		expect(deps(r.team, 'check-2')).toEqual(['implement']);
		expect(deps(r.team, 'check')).toEqual(['check-2', 'scan']);
		expect(names(r.team).indexOf('check-2')).toBe(names(r.team).indexOf('check') - 1);
		expect(steps_of(r.team).get('check')).toBe(5);
		expect(insert_between(team(), 'gate', 'fetch', 'check').ok).toBe(false);
	});
	it('add after a phase, or as a new branch; agents get a starter brief', () => {
		const a = ok(add_after(team(), 'agent', 'check'));
		expect(deps(a.team, a.name!)).toEqual(['check']);
		expect(names(a.team).indexOf(a.name!)).toBe(names(a.team).indexOf('check') + 1);
		expect(a.team.roles.find((r) => r.name === a.name)?.content).toMatch(/You are the agent/);
		const h = ok(add_after(team(), 'human', 'architect'));
		expect(h.team.roles.some((r) => r.name === h.name)).toBe(false);
		const root = ok(add_root(team(), 'fetch'));
		expect(deps(root.team, root.name!)).toEqual([]);
		expect(add_after(team(), 'agent', 'git-resolver').ok).toBe(false);
	});
	it('remove keeps the flow connected; rename updates wiring and role; duplicate; change kind', () => {
		const t = ok(remove_bridged(team(), 'implement')).team;
		expect(deps(t, 'check')).toEqual(['scan', 'tests']);
		expect(t.roles.some((r) => r.name === 'implement')).toBe(false);
		const rn = ok(rename_phase(team(), 'architect', 'design')).team;
		expect(deps(rn, 'tests')).toEqual(['design']);
		expect(rn.roles.some((r) => r.name === 'design')).toBe(true);
		expect(rename_phase(team(), 'architect', 'Bad Name').ok).toBe(false);
		expect(rename_phase(team(), 'architect', 'tests').ok).toBe(false);
		const d = ok(duplicate_phase(team(), 'tests'));
		expect(d.name).toBe('tests-copy');
		expect(deps(d.team, 'tests-copy')).toEqual(['architect']);
		const ck = ok(change_kind(team(), 'scan', 'human')).team.phases.find((p) => p.name === 'scan')!;
		expect(ck).toMatchObject({ type: 'gate', agent: 'hug', depends_on: ['architect'] });
	});
	it('diffs teams and drafts release notes', () => {
		const b = ok(insert_between(team(), 'gate', 'implement', 'check')).team;
		b.roles = b.roles.map((r) => (r.name === 'architect' ? { ...r, content: `${r.content}\nFlag migrations.` } : r));
		b.description = 'New description';
		const d = diff_teams(team(), b);
		expect(d).toContainEqual(expect.objectContaining({ kind: 'added', name: 'check-2' }));
		expect(d).toContainEqual(expect.objectContaining({ kind: 'changed', name: 'check', detail: expect.stringMatching(/runs after/) }));
		expect(d).toContainEqual(expect.objectContaining({ target: 'role', name: 'roles/architect.md', detail: '+1 −0 lines' }));
		expect(d).toContainEqual(expect.objectContaining({ target: 'team', detail: 'description updated' }));
		const notes = release_notes(d);
		expect(notes).toMatch(/- Added check-2/);
		expect(notes).toMatch(/- Revised the architect brief/);
		expect(diff_teams(null, team())).toHaveLength(7);
	});
});

describe('checks (mirror Core validate_team)', () => {
	it('a good team only warns about nothing blocking', () => {
		expect(check_team(team()).filter((p) => p.level === 'error')).toEqual([]);
	});
	it('unknown dependency suggests the closest name, and the fix applies', () => {
		const t = team();
		t.phases = t.phases.map((p) => (p.name === 'check' ? { ...p, depends_on: ['implemnt', 'scan'] } : p));
		const pr = check_team(t).find((p) => p.field === 'depends_on' && p.phase === 'check')!;
		expect(pr.message).toMatch(/did you mean implement/);
		expect(deps(pr.fix!.apply(t), 'check')).toEqual(['implement', 'scan']);
		expect(closest('zzz', ['implement'])).toBeNull();
	});
	it('kind rules', () => {
		const t = team({ phases: [
			P('a', { agent: 'exec', commands: [] }),
			P('b', { type: 'gate', depends_on: ['a'] }),
			P('c', { type: 'gate', agent: 'hug', depends_on: ['a'] }),
			P('d', { type: 'team', agent: undefined, depends_on: ['a'] }),
			P('e', { agent: 'jira', depends_on: ['a'] }),
			P('f', { agent: 'curl', depends_on: ['a'] }),
			P('g', { depends_on: ['a'], max_iterations: 9 }),
			P('h', { depends_on: ['a'], agent: 'nope' }),
			P('Bad', { depends_on: ['a'] }),
		], roles: [], inputs: [] });
		const msgs = check_team(t).filter((p) => p.level === 'error').map((p) => p.message).join('\n');
		expect(msgs).toMatch(/a needs at least one command/);
		expect(msgs).toMatch(/b \(gate\) needs at least one check/);
		expect(msgs).toMatch(/c needs a reviewer/);
		expect(msgs).toMatch(/d needs a sub-team/);
		expect(msgs).toMatch(/e \(jira\) needs an action/);
		expect(msgs).toMatch(/f needs at least one URL/);
		expect(msgs).toMatch(/g: max tries must be a whole number from 1 to 5/);
		expect(msgs).toMatch(/unknown agent “nope”/);
		expect(msgs).toMatch(/“Bad”: use lowercase/);
		expect(check_team(t).some((p) => p.level === 'warning' && /g has no role brief/.test(p.message))).toBe(true);
	});
	it('loops, no starting phase, duplicates, inputs', () => {
		const t = team({ phases: [P('a', { depends_on: ['b'] }), P('b', { depends_on: ['a'] }), P('b')], roles: [] });
		const m = check_team(t).map((p) => p.message).join('\n');
		expect(m).toMatch(/Two phases are called “b”/);
		expect(find_cycle(team({ phases: [P('a', { depends_on: ['b'] }), P('b', { depends_on: ['a'] })] }))).toEqual(['a', 'b']);
		expect(check_team(team({ phases: [P('a', { depends_on: ['b'] }), P('b', { depends_on: ['a'] })], roles: [] })).map((p) => p.message).join('\n')).toMatch(/Nothing can start[\s\S]*Loop: a → b → a/);
		const i = team({ inputs: [{ name: 'unused' }] });
		const ip = check_team(i);
		const missing = ip.find((p) => /\$\(inputs\.ticket\)/.test(p.message))!;
		expect(missing.phase).toBe('fetch');
		expect(missing.fix!.apply(i).inputs).toContainEqual({ name: 'ticket' });
		expect(ip.some((p) => /Input “unused” isn’t used/.test(p.message))).toBe(true);
		expect(check_team(team({ phases: [] })).map((p) => p.message)).toContain('Add a phase to get started.');
	});
});

describe('YAML tools', () => {
	it('round-trips canonical YAML and maps phases to lines', () => {
		const y = team_to_yaml(team());
		const back = parse_yaml(y, team());
		expect(back.ok && names(back.team)).toEqual(names(team()));
		const r = phase_ranges(y);
		expect(r.get('architect')!.from).toBeLessThan(r.get('tests')!.from);
		expect(phase_at_line(y, r.get('check')!.from + 1)).toBe('check');
		expect(problem_line(y, { phase: 'check', field: 'max_iterations' })).toBeGreaterThan(r.get('check')!.from);
		expect(problem_line(y, { phase: null, field: 'description' })).toBe(2);
	});
	it('formats pasted YAML unless it has comments; reports error positions', () => {
		const messy = 'name: x\ndescription:   "d"\nphases:\n    - name: a\n      type: standard\n      agent: exec\n      commands: [{name: t, run: ls}]\n';
		const f = format_yaml(messy, team());
		expect(f.ok && f.changed).toBe(true);
		expect(f.ok && f.text).toMatch(/^name: feature-dev\n/);
		const c = format_yaml(`# keep me\n${messy}`, team());
		expect(c.ok && c.kept_comments && !c.changed).toBe(true);
		expect(has_comments('url: "http://a#b"')).toBe(false);
		expect(has_comments('a: 1 # note')).toBe(true);
		const bad = format_yaml('phases:\n  - name: a\n   type: x', team());
		expect(bad.ok).toBe(false);
		expect(!bad.ok && bad.line).toBeGreaterThan(0);
		expect(error_position('bad indentation (3:4)')).toEqual({ line: 3, col: 4 });
		expect(parse_yaml('name: x', team()).ok).toBe(false);
	});
});

describe('publish', () => {
	it('versions, bump suggestion, slug/scope, body', () => {
		expect(next_version(null, 'minor')).toBe('1.0.0');
		expect(next_version('1.4.2', 'patch')).toBe('1.4.3');
		expect(next_version('1.4.2', 'minor')).toBe('1.5.0');
		expect(next_version('1.4.2', 'major')).toBe('2.0.0');
		expect(suggest_bump([{ kind: 'added', target: 'phase', detail: '' }])).toBe('minor');
		expect(suggest_bump([{ kind: 'removed', target: 'phase', detail: '' }])).toBe('major');
		expect(suggest_bump([])).toBe('patch');
		expect(team_slug({ name: '@acme/Feature Dev' })).toBe('feature-dev');
		expect(team_scope({ name: '@acme/x' }, 'me')).toBe('acme');
		expect(team_scope({ name: 'x' }, 'me')).toBe('me');
		const b = publish_body(team(), { scope: 'acme', current: '1.0.0', bump: 'minor', changelog: ' notes ', listed: false });
		expect(b).toMatchObject({ name: 'feature-dev', scope: 'acme', bump: 'minor', changelog: 'notes', visibility: 'private' });
		expect(b.version).toBeUndefined();
		const pkg = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(String(b.data_base64)), (ch) => ch.charCodeAt(0))));
		expect(pkg['team.yml']).toMatch(/phases:/);
		expect(pkg.roles).toHaveLength(5);
		expect(publish_body(team(), { scope: 'acme', current: null, bump: 'minor', changelog: '', listed: true })).toMatchObject({ version: '1.0.0', visibility: 'public' });
	});
});

describe('builder_team_from_saved', () => {
	const detail = {
		id: 't1', name: 'feature-dev', scope: 'acme', description: 'Ticket to PR', latest_version: '1.4.2',
		workflow: { phases: [{ name: 'design', type: 'standard', agent: 'claude-code', depends_on: [] }] },
		roles: [{ name: 'design', content_md: '# design' }], draft: null,
	};
	it('opens the latest version, keeping the scope in the name', () => {
		const r = builder_team_from_saved(detail)!;
		expect(r.from_draft).toBe(false);
		expect(r.team).toMatchObject({ name: '@acme/feature-dev', version: '1.4.2', description: 'Ticket to PR' });
		expect(r.team.phases.map((p) => p.name)).toEqual(['design']);
	});
	it('prefers the unpublished changes, saved as builder JSON or as team.yml', () => {
		const json = builder_team_from_saved({ ...detail, draft: { manifest: JSON.stringify({ name: 'feature-dev', description: 'x', phases: [{ name: 'a', depends_on: [] }, { name: 'b', depends_on: ['a'] }] }), description: 'Edited' } })!;
		expect(json.from_draft).toBe(true);
		expect(json.team).toMatchObject({ name: '@acme/feature-dev', description: 'Edited', version: '1.4.2' });
		expect(json.team.phases.map((p) => p.name)).toEqual(['a', 'b']);
		const yml = builder_team_from_saved({ ...detail, draft: { manifest: 'name: feature-dev\ndescription: from yaml\nphases:\n  - name: only\n    agent: claude-code\n' } })!;
		expect(yml.from_draft).toBe(true);
		expect(yml.team.phases.map((p) => p.name)).toEqual(['only']);
	});
});
