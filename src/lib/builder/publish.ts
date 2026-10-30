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

/** The builder team as files (team.yml and roles/<name>.md): what a publish sends; Core makes the zip. */
export function team_files(team: GeneratedTeam): Record<string, string> {
	const files: Record<string, string> = { 'team.yml': team_to_yaml(team) };
	for (const r of team.roles) files[`roles/${r.name}.md`] = r.content;
	return files;
}

/**
 * What a save sends to the builder's draft (PLAN-team-bundle S1.3c): the files that differ from what the draft
 * holds, and the role files the team no longer has. README.md and dependencies.yml aren't edited here, so stay.
 */
export function draft_changes(held: Record<string, string>, now: Record<string, string>): { upload: Record<string, string>; remove: string[] } {
	const upload: Record<string, string> = {};
	for (const [path, text] of Object.entries(now)) if (held[path] !== text) upload[path] = text;
	const remove = Object.keys(held).filter((p) => p.startsWith('roles/') && !(p in now)).sort();
	return { upload, remove };
}

/** A version's files as the team detail `builder_team_from_detail` reads: team.yml text and the role briefs. */
export function detail_from_files(files: Record<string, string>): { raw_manifest: string; roles: Array<{ name: string; content_md: string }> } {
	const roles = Object.keys(files).filter((p) => /^roles\/[^/]+\.md$/.test(p)).sort()
		.map((p) => ({ name: p.slice('roles/'.length, -'.md'.length), content_md: files[p] }));
	return { raw_manifest: files['team.yml'] ?? '', roles };
}

/**
 * The multipart body of `teams/files/upload` (PLAN-team-bundle §2.6): a JSON `payload` part and each file as an
 * attachment named by its path. Without a `version_id`, CliqHub starts a new draft.
 */
export function upload_form(files: Record<string, string>, payload: { team_id: string; version_id?: string }): FormData {
	const form = new FormData();
	form.append('payload', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
	for (const [path, text] of Object.entries(files)) {
		form.append('files', new Blob([text], { type: path.endsWith('.md') ? 'text/markdown' : 'text/yaml' }), path);
	}
	return form;
}

/** `listed`: public (everyone, the marketplace) when true, else private to the scope's members. */
/** The `teams/publish` body: publishes the draft `version_id` (its files uploaded with `upload_form`; agents are in its team.yml). */
export function publish_body(team: GeneratedTeam, o: { scope: string; current: string | null; bump: Bump; changelog: string; listed: boolean; version_id: string }): Record<string, unknown> {
	const body: Record<string, unknown> = {
		name: team_slug(team),
		scope: o.scope || undefined,
		description: team.description,
		tags: team.tags ?? [],
		visibility: o.listed ? 'public' : 'private',
		version_id: o.version_id,
		...(o.changelog.trim() ? { changelog: o.changelog.trim() } : {}),
	};
	if (o.current) body.bump = o.bump; else body.version = '1.0.0';
	return body;
}
