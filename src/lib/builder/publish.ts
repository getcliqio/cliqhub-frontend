/**
 * Publishing a builder team: version maths and the /v1/teams/publish body
 * (same package shape the classic publish dialog sends).
 */
import type { GeneratedTeam } from '@/lib/builder/store';
import { team_to_yaml } from '@/lib/builder/yaml_tools';

export type Bump = 'patch' | 'minor' | 'major';

export function next_version(current: string | null, bump: Bump): string {
	if (!current) return '1.0.0';
	const m = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
	if (!m) return '1.0.0';
	const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
	if (bump === 'major') return `${a + 1}.0.0`;
	if (bump === 'minor') return `${a}.${b + 1}.0`;
	return `${a}.${b}.${c + 1}`;
}

/** Suggest a bump from what changed: removed phases or inputs → major; new phases → minor; else patch. */
export function suggest_bump(changes: Array<{ kind: string; target: string; detail: string }>): Bump {
	if (changes.some((c) => c.kind === 'removed' && c.target === 'phase')) return 'major';
	if (changes.some((c) => c.kind === 'added' && c.target === 'phase')) return 'minor';
	return 'patch';
}

export function team_slug(team: Pick<GeneratedTeam, 'name'>): string {
	return team.name.replace(/^@[^/]+\//, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled-team';
}
export function team_scope(team: Pick<GeneratedTeam, 'name'>, fallback: string): string {
	const m = /^@([^/]+)\//.exec(team.name);
	return m ? m[1] : fallback;
}

function b64_utf8(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let bin = '';
	bytes.forEach((b) => { bin += String.fromCharCode(b); });
	return btoa(bin);
}

export function publish_body(team: GeneratedTeam, o: { scope: string; current: string | null; bump: Bump; changelog: string; listed: boolean }): Record<string, unknown> {
	const agents: Record<string, Record<string, unknown>> = {};
	for (const a of team.agents ?? []) {
		const def: Record<string, unknown> = {};
		if (a.entry) def.entry = a.entry;
		if (a.env?.length) def.env = a.env;
		agents[a.name] = def;
	}
	const pkg = { 'team.yml': team_to_yaml(team), roles: team.roles.map((r) => ({ name: r.name, content: r.content })) };
	const body: Record<string, unknown> = {
		name: team_slug(team),
		scope: o.scope || undefined,
		description: team.description,
		tags: team.tags ?? [],
		visibility: o.listed ? 'public' : 'private',
		data_base64: b64_utf8(JSON.stringify(pkg)),
		...(o.changelog.trim() ? { changelog: o.changelog.trim() } : {}),
		...(Object.keys(agents).length ? { agents } : {}),
	};
	if (o.current) body.bump = o.bump; else body.version = '1.0.0';
	return body;
}
