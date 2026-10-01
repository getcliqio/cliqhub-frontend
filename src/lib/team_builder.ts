/**
 * Open a team version in the Builder (edit or fork) from a raw
 * `/v1/teams/get_by_id` payload — same session hand-off the classic
 * team page uses (see components/team_actions.tsx).
 */
import { BUILDER_SESSION_KEYS, normalize_builder_team } from '@/lib/builder/session_restore';

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
