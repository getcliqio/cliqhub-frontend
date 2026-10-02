/**
 * Open a team version in the Builder (edit or fork) from a raw
 * `/v1/teams/get_by_id` payload — same session hand-off the classic
 * team page uses (see components/team_actions.tsx).
 */
import { BUILDER_SESSION_KEYS, normalize_builder_team } from '@/lib/builder/session_restore';
import { empty_builder_team } from '@/lib/builder/empty_team';
import { parse_team_yml_text } from '@/lib/team_yml_parse';
import type { GeneratedTeam } from '@/lib/builder/store';

type Rec = Record<string, unknown>;

export function builder_team_from_detail(raw: Rec, opts: { label: string; version?: string | null; fork?: boolean }): ReturnType<typeof normalize_builder_team> {
	const wf = (raw.workflow ?? {}) as { phases?: Rec[]; support?: Rec[] };
	const phases: Rec[] = [...(wf.phases ?? []), ...(wf.support ?? []).map((p): Rec => ({ ...p, is_support: true }))];
	const agents = (raw.agents && typeof raw.agents === 'object' ? raw.agents : {}) as Record<string, { entry?: string; env?: string[] }>;
	return normalize_builder_team({
		name: opts.fork ? `${opts.label}-fork` : opts.label,
		description: raw.description ?? '',
		inputs: raw.inputs,
		use_when: raw.use_when,
		not_for: raw.not_for,
		...(opts.fork ? {} : { version: opts.version ?? undefined }),
		phases: phases.map((p) => ({
			name: p.name,
			type: p.type,
			depends_on: Array.isArray(p.depends_on) ? p.depends_on : [],
			commands: p.commands,
			max_iterations: p.max_iterations,
			agent: p.agent,
			sources: p.sources,
			target_entries: p.target_entries ?? p.targets,
			review: p.review,
			...(p.is_support ? { is_support: true } : {}),
		})),
		roles: (Array.isArray(raw.roles) ? raw.roles as Rec[] : []).map((r) => ({ name: r.name, content: r.content_md })),
		agents: Object.entries(agents).map(([name, def]) => ({ name, entry: def?.entry, env: def?.env })),
	});
}

/** Stash the team for the Builder and return the URL to navigate to. */
export function builder_href(raw: Rec, opts: { label: string; version?: string | null; fork?: boolean; from: string }): string | null {
	const data = builder_team_from_detail(raw, opts);
	if (!data) return null;
	try {
		sessionStorage.setItem(opts.fork ? BUILDER_SESSION_KEYS.fork : BUILDER_SESSION_KEYS.view, JSON.stringify(data));
	} catch {
		return null;
	}
	const from = encodeURIComponent(opts.from);
	return opts.fork ? `/builder?fork=1&from=${from}` : `/builder?view=1&tab=yaml&from=${from}`;
}

/**
 * The Builder's copy of a team you can edit, from `/v1/teams/get_by_id { team_id }`:
 * its unpublished working copy when there is one, else its latest version. The
 * name keeps the scope (`@scope/name`) so saving and publishing stay on this team.
 */
export function builder_team_from_saved(raw: Rec): { team: GeneratedTeam; from_draft: boolean } | null {
	const scope = typeof raw.scope === 'string' && raw.scope ? raw.scope : null;
	const name = String(raw.name ?? '');
	const label = scope ? `@${scope}/${name}` : name;
	const latest = typeof raw.latest_version === 'string' && raw.latest_version !== '0.0.0' ? raw.latest_version : undefined;
	const draft = (raw.draft && typeof raw.draft === 'object' ? raw.draft : null) as { manifest?: unknown; description?: unknown } | null;
	const text = typeof draft?.manifest === 'string' ? draft.manifest.trim() : '';
	if (text) {
		let team: GeneratedTeam | null = null;
		try {
			team = normalize_builder_team(JSON.parse(text));
		} catch {
			const r = parse_team_yml_text(text, empty_builder_team(name));
			team = r.error ? null : r.team;
		}
		if (team) {
			const description = typeof draft?.description === 'string' ? draft.description : team.description;
			return { team: { ...team, name: label, description, version: latest }, from_draft: true };
		}
	}
	const team = builder_team_from_detail(raw, { label, version: latest ?? null });
	return team ? { team: { ...team, name: label }, from_draft: false } : null;
}
