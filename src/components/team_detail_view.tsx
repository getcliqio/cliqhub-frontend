import { useMemo } from 'react';
import type { RoleDetail, WorkflowPhase, AgentDef } from '@/lib/types';
import { WorkflowGraph } from '@/components/workflow_graph';
import { RoleAccordion } from '@/components/role_accordion';
import { CopyButton } from '@/components/copy_button';
import { TeamActions } from '@/components/team_actions';
import { AgentSection } from '@/components/agent_section';
import { VersionSelector } from '@/components/version_selector';
import { RenameTeamButton } from '@/components/rename_team_button';
import { DangerZone } from '@/components/danger_zone';
import { build_team_yml } from '@/lib/team_export';

/**
 * Shape returned by the BFF `/v1/teams/get_by_id` endpoint.
 * Matches `TeamDetailDTO` on the BFF — fields are flat at the top level.
 */
export interface TeamDetailData {
    name: string;
    scope: string | null;
    description: string;
    author: string | null;
    author_id?: string | null;
    license: string;
    visibility: 'public' | 'private' | 'draft';
    install_count: number;
    created_at: string;
    updated_at: string;
    tags: string[];
    versions: { version: string; changelog: string; published_at: string }[];
    roles: RoleDetail[];
    workflow: { phases: WorkflowPhase[]; support?: WorkflowPhase[] };
    agents: Record<string, AgentDef>;
    readme: string;
    cliq_version: string | null;
    tools: string[];
    inputs?: { name: string; description?: string }[];
    use_when?: string[];
    not_for?: string[];
    latest_version: string | null;
    listed?: boolean;
    /** Raw manifest YAML from the teams table — always current. */
    raw_manifest?: string | null;
    /** Server-computed permissions for the current user. */
    can_edit?: boolean;
    can_delete?: boolean;
    can_toggle_listing?: boolean;
}

interface Props {
    data: TeamDetailData;
    /** Base path for version selector links (e.g. /admin/teams/cliq/my-team). */
    base_path: string;
    /** Optional version the user is currently viewing (defaults to latest). */
    display_version?: string | null;
    /**
     * When true, omit the header Edit/Fork/Download cluster — the parent
     * page owns a single shared action toolbar instead.
     */
    hide_actions?: boolean;
    /** When provided, passed to AgentSection to flag unregistered agents. */
    registered_agents?: Set<string>;
}

/**
 * Shared team detail rendering used by public, admin, and account routes.
 * The parent page handles data fetching and access control.
 */
export function TeamDetailView({ data, base_path, display_version, hide_actions, registered_agents }: Props) {
    const {
        name, scope, description, author, author_id,
        license, install_count,
        versions, roles, workflow,
        cliq_version, tools, agents,
        inputs, use_when, not_for,
        latest_version,
        can_edit, can_delete, can_toggle_listing, listed,
    } = data;

    const all_phases: WorkflowPhase[] = [
        ...(workflow?.phases || []),
        ...((workflow?.support || []).map(p => ({ ...p, is_support: true }))),
    ];
    const scope_prefix = scope ? `@${scope}/` : '';
    const effective_display_version = display_version ?? latest_version;
    const is_viewing_older = effective_display_version
        && latest_version
        && effective_display_version !== latest_version;

    /** Install command — append @version when viewing a non-latest version. */
    const version_suffix = is_viewing_older ? `@${effective_display_version}` : '';
    const install_cmd = scope
        ? `cliq team install @${scope}/${name}${version_suffix}`
        : `cliq team install ${name}${version_suffix}`;

    /**
     * Prefer the raw manifest YAML from the teams table — it's always
     * current. Fall back to the reconstructed version from team_versions
     * (which only updates on publish) for older teams / cached responses.
     */
    const team_yml = useMemo(() => {
        if (data.raw_manifest) return data.raw_manifest;

        return build_team_yml({
            name: scope ? `@${scope}/${name}` : name,
            description,
            tags: data.tags,
            inputs,
            use_when,
            not_for,
            phases: all_phases.map((p) => ({
                name: p.name,
                type: p.type,
                depends_on: p.depends_on || [],
                commands: p.commands,
                max_iterations: p.max_iterations,
                agent: p.agent,
                sources: p.sources,
                target_entries: p.target_entries,
                review: p.review,
                action: p.action,
                model: p.model,
                team: p.team,
                ...(p.is_support ? { is_support: true } : {}),
            })),
            roles: roles.map((r) => ({ name: r.name, content: r.content_md })),
            agents: Object.entries(agents || {}).map(([agent_name, def]) => ({
                name: agent_name,
                entry: def.entry,
                env: def.env,
            })),
        });
    }, [data.raw_manifest, name, scope, description, data.tags, inputs, use_when, not_for, all_phases, roles, agents]);

    return (
        <>
            {/* Header */}
            <div className="mb-8">
                <div className={`mb-2 flex items-center ${hide_actions ? '' : 'justify-between'}`}>
                    <div className="flex flex-wrap items-baseline gap-3">
                        <RenameTeamButton scope={scope ?? ''} name={name} author_id={author_id ?? undefined} />
                        {effective_display_version && versions.length > 0 && (
                            <VersionSelector
                                versions={versions}
                                selected={effective_display_version}
                                base_path={base_path}
                            />
                        )}
                        {effective_display_version && effective_display_version === latest_version && (
                            <span className="rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-semibold text-emerald-700">
                                latest
                            </span>
                        )}
                        {effective_display_version && effective_display_version !== latest_version && (
                            <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-semibold text-amber-700">
                                older version
                            </span>
                        )}
                    </div>
                    {!hide_actions ? (
                        <TeamActions
                            team_name={`${scope_prefix}${name}`}
                            description={description}
                            version={effective_display_version ?? undefined}
                            is_latest={effective_display_version === latest_version}
                            can_edit={can_edit}
                            can_delete={can_delete}
                            can_toggle_listing={can_toggle_listing}
                            listed={listed}
                            phases={all_phases}
                            roles={roles}
                            agents={agents}
                            metadata={{ inputs, use_when, not_for }}
                        />
                    ) : null}
                </div>
                <p className="text-lg text-slate-700">{description}</p>
                <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                    {author && <span>by {author}</span>}
                    <span>{install_count.toLocaleString()} installs</span>
                    <span>{license} license</span>
                </div>
            </div>

            {/* YAML (inputs + phases) | Workflow graph */}
            <section className="mb-10">
                <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
                    <div className="min-w-0">
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <h2 className="text-xl font-bold">team.yml</h2>
                            <CopyButton text={team_yml} />
                        </div>
                        <p className="mb-3 text-xs text-slate-500">
                            Inputs and <code className="rounded bg-slate-100 px-1">phases</code> (ordered workflow) as YAML.
                        </p>
                        <pre className="max-h-[70vh] overflow-auto rounded-xl border border-slate-800 bg-slate-900 p-4 font-mono text-[11px] leading-relaxed text-slate-100">
                            {team_yml}
                        </pre>
                    </div>
                    <div className="min-w-0">
                        <h2 className="mb-3 text-xl font-bold">Workflow</h2>
                        <p className="mb-3 text-xs text-slate-500">
                            Visual view of the same ordered <code className="rounded bg-slate-100 px-1">phases</code> list.
                        </p>
                        {all_phases.length > 0 ? (
                            <div className="rounded-xl border border-slate-200 bg-white p-4">
                                <WorkflowGraph phases={all_phases} agents={agents} />
                            </div>
                        ) : (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
                                No phases published for this version.
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* Install command */}
            <div className="mb-10 rounded-xl border border-indigo-200 bg-indigo-50 p-6">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-indigo-600">CLI Install</p>
                <div className="flex items-center justify-between">
                    <code className="text-lg font-semibold text-indigo-900">{install_cmd}</code>
                    <CopyButton text={install_cmd} />
                </div>
                {latest_version && (
                    <div className="mt-3 space-y-1 border-t border-indigo-200 pt-3">
                        <div className="flex items-center gap-2">
                            <code className="text-sm text-indigo-700">{install_cmd}</code>
                            <span className="text-xs text-indigo-400"># latest (v{latest_version})</span>
                        </div>
                        {effective_display_version && effective_display_version !== latest_version && (
                            <div className="flex items-center gap-2">
                                <code className="text-sm text-indigo-700">{install_cmd}@{effective_display_version}</code>
                                <span className="text-xs text-indigo-400"># this version</span>
                            </div>
                        )}
                        {versions.length > 1 && (
                            <div className="flex items-center gap-2">
                                <code className="text-sm text-indigo-700">{install_cmd}@{versions[versions.length - 1].version}</code>
                                <span className="text-xs text-indigo-400"># specific version</span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Roles */}
            {roles.length > 0 && (
                <section className="mb-10">
                    <h2 className="mb-4 text-xl font-bold">
                        Roles <span className="text-base font-normal text-slate-500">({roles.length})</span>
                    </h2>
                    <RoleAccordion roles={roles} />
                </section>
            )}

            {/* Agents */}
            {Object.keys(agents).length > 0 && (
                <section className="mb-10">
                    <AgentSection agents={agents} phases={all_phases} registered_agents={registered_agents} />
                </section>
            )}

            {/* Requirements */}
            {(cliq_version || (tools && tools.length > 0)) && (
                <section className="mb-10">
                    <h2 className="mb-4 text-xl font-bold">Requirements</h2>
                    <div className="flex flex-wrap gap-3">
                        {cliq_version && (
                            <span className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
                                <span className="text-slate-500">cliq </span>
                                <span className="font-mono font-semibold">{cliq_version}</span>
                            </span>
                        )}
                        {tools.map((tool) => (
                            <span key={tool} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
                                <span className="font-mono font-semibold">{tool}</span>
                            </span>
                        ))}
                    </div>
                </section>
            )}

            {!hide_actions ? (
                <DangerZone
                    scope={scope}
                    name={name}
                    author_id={author_id ?? ''}
                />
            ) : null}
        </>
    );
}
