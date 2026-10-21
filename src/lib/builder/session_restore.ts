import type { GeneratedTeam } from '@/lib/builder/store';

export const BUILDER_SESSION_KEYS = {
	view: 'cliqhub_view',
	fork: 'cliqhub_fork',
	publish: 'cliqhub_publish_draft',
} as const;

/** Survive React Strict Mode remounts (effects run twice; Provider state resets). */
const pending_restores = new Map<string, GeneratedTeam>();

export function normalize_builder_team(raw: unknown): GeneratedTeam | null {
	if (!raw || typeof raw !== 'object') return null;
	const team = raw as Partial<GeneratedTeam>;
	if (typeof team.name !== 'string' || !team.name.trim()) return null;

	const phases = Array.isArray(team.phases) ? team.phases : [];
	return {
		name: team.name.replace(/^@[^/]+\//, ''),
		description: typeof team.description === 'string' ? team.description : '',
		version: team.version,
		tags: team.tags,
		inputs: team.inputs,
		use_when: team.use_when,
		not_for: team.not_for,
		phases: phases.map((p) => ({
			...p,
			depends_on: Array.isArray(p?.depends_on) ? p.depends_on : [],
		})),
		roles: Array.isArray(team.roles) ? team.roles : [],
		agents: Array.isArray(team.agents) ? team.agents : [],
		...(team.source && typeof team.source === 'object' ? { source: team.source } : {}),
		...(typeof team.source_text === 'string' ? { source_text: team.source_text } : {}),
	};
}

/**
 * A working copy saved before the builder kept team.yml: give it the published team.yml to start from, and
 * fill in the phase fields it lost on the way (an action, a sub-team, its args…) from the published version.
 */
export function adopt_source(team: GeneratedTeam, published: GeneratedTeam): GeneratedTeam {
	if (team.source || !published.source) return team;
	const by_name = new Map(published.phases.map((p) => [p.name, p]));
	return {
		...team,
		source: published.source,
		phases: team.phases.map((p) => {
			const pub = by_name.get(p.name);
			if (!pub || p.source) return p;
			const filled = { ...p };
			for (const [k, v] of Object.entries(pub)) if ((filled as Record<string, unknown>)[k] === undefined) (filled as Record<string, unknown>)[k] = v;
			return filled;
		}),
	};
}

export function read_builder_session_team(key: string): GeneratedTeam | null {
	const cached = pending_restores.get(key);
	if (cached) return cached;

	const raw = sessionStorage.getItem(key);
	if (!raw) return null;

	try {
		const team = normalize_builder_team(JSON.parse(raw));
		if (!team) {
			sessionStorage.removeItem(key);
			return null;
		}
		pending_restores.set(key, team);
		return team;
	} catch {
		sessionStorage.removeItem(key);
		return null;
	}
}

/** Call when leaving the builder so a later visit does not revive an old edit. */
export function clear_builder_session_restores(): void {
	for (const key of Object.values(BUILDER_SESSION_KEYS)) {
		sessionStorage.removeItem(key);
		pending_restores.delete(key);
	}
}
