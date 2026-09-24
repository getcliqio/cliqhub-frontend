import type { GeneratedTeam } from '@/lib/builder/store';

/** Empty canvas starter — same idea as desktop "Builder" tab with no phases yet. */
export function empty_builder_team(name = 'untitled-team'): GeneratedTeam {
	return {
		name,
		description: '',
		version: '0.1.0',
		phases: [],
		roles: [],
		agents: [],
	};
}
