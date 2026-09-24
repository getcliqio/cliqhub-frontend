import { describe, it, expect } from 'vitest';

import { build_team_yml, type ExportTeamData } from '../src/lib/team_export';


function base_team(overrides?: Partial<ExportTeamData>): ExportTeamData {
	return {
		name: 'test-team',
		description: 'A test team',
		phases: [
			{ name: 'dev', type: 'standard', depends_on: [] },
		],
		roles: [{ name: 'dev', content: 'Developer role' }],
		...overrides,
	};
}


describe('build_team_yml — sources/target_entries serialization', () => {

	it('omits sources/target_entries when not present', () => {
		const yml = build_team_yml(base_team());
		expect(yml).not.toContain('sources:');
		expect(yml).not.toContain('target_entries:');
	});

	it('serializes sources entries on standard phase with connector agent', () => {
		const yml = build_team_yml(base_team({
			phases: [{
				name: 'research',
				type: 'standard',
				depends_on: [],
				agent: 'connector',
				sources: [
					{ url: 'https://example.com/doc', name: 'spec' },
					{ url: '$(inputs.data_url)', name: 'raw-data' },
				],
			}],
		}));

		expect(yml).toContain('sources:');
		expect(yml).toContain('url: "https://example.com/doc"');
		expect(yml).toContain('name: spec');
		expect(yml).toContain('url: "$(inputs.data_url)"');
		expect(yml).toContain('name: raw-data');
	});

	it('serializes sources without url when only name is given', () => {
		const yml = build_team_yml(base_team({
			phases: [{
				name: 'dev',
				type: 'standard',
				depends_on: [],
				sources: [{ name: 'data' }],
			}],
		}));

		expect(yml).toContain('sources:');
		expect(yml).toContain('name: data');
		expect(yml).not.toContain('url:');
	});

	it('serializes target_entries on standard phase', () => {
		const yml = build_team_yml(base_team({
			phases: [{
				name: 'publish',
				type: 'standard',
				depends_on: [],
				target_entries: [
					{ name: 'Final Report', file: 'output/report.md', url: 'gdoc://abc123', mode: 'replace' },
				],
			}],
		}));

		expect(yml).toContain('target_entries:');
		expect(yml).toContain('file: output/report.md');
		expect(yml).toContain('url: "gdoc://abc123"');
		expect(yml).toContain('mode: replace');
		expect(yml).toContain('name: Final Report');
	});

	it('omits mode when create (default)', () => {
		const yml = build_team_yml(base_team({
			phases: [{
				name: 'dev',
				type: 'standard',
				depends_on: [],
				target_entries: [{ name: 'output', file: 'out.md', url: 'gdoc://x', mode: 'create' }],
			}],
		}));

		expect(yml).toContain('target_entries:');
		expect(yml).not.toContain('mode:');
	});

	it('serializes sources and target_entries as separate phases', () => {
		const yml = build_team_yml(base_team({
			phases: [
				{ name: 'ingest', type: 'standard', depends_on: [], agent: 'connector', sources: [{ url: 'https://data.example.com', name: 'input' }] },
				{ name: 'publish', type: 'standard', depends_on: ['ingest'], target_entries: [{ name: 'result', file: 'result.md', url: 'gdrive://folder' }] },
			],
		}));

		expect(yml).toContain('sources:');
		expect(yml).toContain('target_entries:');
		expect(yml.indexOf('sources:')).toBeLessThan(yml.indexOf('target_entries:'));
	});

	it('serializes multiple phases with sources and target_entries', () => {
		const yml = build_team_yml(base_team({
			phases: [
				{
					name: 'gather',
					type: 'standard',
					depends_on: [],
					agent: 'connector',
					sources: [{ url: 'https://a.com', name: 'a' }],
				},
				{
					name: 'publish',
					type: 'standard',
					depends_on: ['gather'],
					target_entries: [{ name: 'output', file: 'out.md', url: 'gdoc://x', mode: 'append' }],
				},
			],
		}));

		expect(yml).toContain('name: gather');
		expect(yml).toContain('name: a');
		expect(yml).toContain('name: publish');
		expect(yml).toContain('mode: append');
	});
});


describe('build_team_yml — gate phase serialization', () => {

	it('serializes gate phase with full review fields', () => {
		const yml = build_team_yml(base_team({
			phases: [
				{ name: 'dev', type: 'standard', depends_on: [] },
				{
					name: 'human-review',
					type: 'gate',
					depends_on: ['dev'],
					commands: [{ name: 'tests', run: 'npm test' }],
					max_iterations: 3,
					review: {
						reviewer: 'senior-devs',
						artifacts: ['src/', 'docs/design.md'],
						timeout: '2h',
						remind_every: '30m',
					},
				},
			],
			roles: [
				{ name: 'dev', content: 'Developer' },
				{ name: 'human-review', content: 'If tests pass: approve and proceed.' },
			],
		}));

		expect(yml).toContain('type: gate');
		expect(yml).toContain('review:');
		expect(yml).toContain('reviewer: senior-devs');
		expect(yml).toContain('artifacts:');
		expect(yml).toContain('- src/');
		expect(yml).toContain('- docs/design.md');
		expect(yml).toContain('timeout: 2h');
		expect(yml).toContain('remind_every: 30m');
	});

	it('serializes gate phase with reviewer only', () => {
		const yml = build_team_yml(base_team({
			phases: [{
				name: 'review',
				type: 'gate',
				depends_on: [],
				review: { reviewer: 'architects' },
			}],
			roles: [{ name: 'review', content: 'If code is good: approve and proceed.' }],
		}));

		expect(yml).toContain('type: gate');
		expect(yml).toContain('review:');
		expect(yml).toContain('reviewer: architects');
		expect(yml).not.toContain('artifacts:');
		expect(yml).not.toContain('timeout:');
		expect(yml).not.toContain('remind_every:');
	});

	it('serializes gate phase with multiple reviewers', () => {
		const yml = build_team_yml(base_team({
			phases: [{
				name: 'review',
				type: 'gate',
				depends_on: [],
				review: { reviewer: ['senior-devs', 'architects'] },
			}],
			roles: [{ name: 'review', content: 'If code is good: approve and proceed.' }],
		}));

		expect(yml).toContain('review:');
		expect(yml).toContain('reviewer:');
		expect(yml).toContain('- senior-devs');
		expect(yml).toContain('- architects');
	});

	it('omits reviewer when not present on gate phase', () => {
		const yml = build_team_yml(base_team({
			phases: [{
				name: 'review',
				type: 'gate',
				depends_on: [],
			}],
			roles: [{ name: 'review', content: 'If code is good: approve and proceed.' }],
		}));

		expect(yml).toContain('type: gate');
		expect(yml).not.toContain('reviewer:');
	});
});
