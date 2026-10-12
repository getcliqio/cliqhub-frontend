import { describe, it, expect } from 'vitest';
import { find_item, yaml_outline } from '@/components/graphite/g_yaml_view';
import { team_yaml_href } from '@/pages/realm/run_detail_page';

const YML = [
	'name: design-lld          # 0',
	'inputs:',
	'  - name: "jira_key"',
	'    required: true',
	'  - name: reviewers',
	'phases:                   # 5',
	'  - name: draft-lld',
	'    agent: cursor',
	'    commands:',
	'      - name: nested-not-a-phase',
	'',
	'  - name: hug-lld        # 11',
	'    type: gate',
	'',
	'review:',
].join('\n');

describe('yaml_outline', () => {
	it('lists top-level keys and the named items of each list, with line ranges', () => {
		const o = yaml_outline(YML);
		expect(o.map((s) => [s.key, s.start, s.end])).toEqual([['name', 0, 0], ['inputs', 1, 4], ['phases', 5, 13], ['review', 14, 14]]);
		expect(o[1].items).toEqual([{ name: 'jira_key', start: 2, end: 3 }, { name: 'reviewers', start: 4, end: 4 }]);
		// A nested `- name:` (a command) is not a phase; trailing blank lines are not part of an item.
		expect(o[2].items).toEqual([{ name: 'draft-lld', start: 6, end: 9 }, { name: 'hug-lld', start: 11, end: 12 }]);
	});

	it('finds an item by name (phases first), and copes with text that is not YAML', () => {
		expect(find_item(yaml_outline(YML), 'hug-lld')).toEqual({ name: 'hug-lld', start: 11, end: 12 });
		expect(find_item(yaml_outline(YML), 'nope')).toBeNull();
		expect(yaml_outline('  just some text\n: broken')).toEqual([]);
	});
});

describe('team_yaml_href', () => {
	it('opens the YAML of the exact team version a run used', () => {
		expect(team_yaml_href({ team_label: '@measureone/design-lld', team_version: '1.4.0' })).toBe('/teams/measureone/design-lld?tab=files&file=team.yml&v=1.4.0');
		expect(team_yaml_href({ team_label: '@cliq/hello-world' })).toBe('/teams/cliq/hello-world?tab=files&file=team.yml');
		expect(team_yaml_href({ team_label: 'local-team' })).toBeNull();
	});
});
