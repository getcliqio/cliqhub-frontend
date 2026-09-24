import { useState } from 'react';
import { useNavigate } from 'react-router';
import { generate_team_zip, type ExportTeamData, type ExportPhase } from '@/lib/team_export';
import { BUILDER_SESSION_KEYS, normalize_builder_team } from '@/lib/builder/session_restore';
import { useAuthFetch } from '@/lib/auth_context';

interface PhaseData {
    name: string;
    type: string;
    depends_on?: string[];
    commands?: { name: string; run: string; scope?: string; if?: string; escalate_on_fail?: boolean }[];
    max_iterations?: number;
    agent?: string;
    sources?: { name: string; ref?: string; url?: string }[];
    target_entries?: { name: string; file: string; ref?: string; url?: string; mode?: string }[];
    review?: { reviewer?: string | string[]; artifacts?: string[]; timeout?: string; remind_every?: string };
    is_support?: boolean;
}

interface RoleData {
    name: string;
    content_md: string;
}

interface AgentData {
    entry?: string;
    env?: string[];
}

interface Props {
    team_name: string;
    description: string;
    version?: string;
    is_latest: boolean;
    /** Server-computed permission — can the caller edit this team? */
    can_edit?: boolean;
    /** Server-computed permission — can the caller delete this team? */
    can_delete?: boolean;
    /** Server-computed permission — can the caller toggle listing? */
    can_toggle_listing?: boolean;
    /** Whether the team is currently listed in the marketplace. */
    listed?: boolean;
    phases: PhaseData[];
    roles: RoleData[];
    agents: Record<string, AgentData>;
    metadata: { inputs?: { name: string; description?: string }[]; use_when?: string[]; not_for?: string[] };
    /** Labeled buttons for a shared toolbar (default: icon-only). */
    labeled?: boolean;
    className?: string;
    /** Callback fired after a destructive action (delete, toggle listing). */
    on_mutate?: () => void;
}

/**
 * Team action cluster — Edit (author/admin only) / Fork / Download.
 * Use `labeled` when embedding in a shared page toolbar with other CTAs.
 */
export function TeamActions({
    team_name, description, version,
    is_latest,
    can_edit: can_edit_prop, can_delete: can_delete_prop,
    can_toggle_listing, listed,
    phases, roles, agents, metadata,
    labeled = false,
    className,
    on_mutate,
}: Props) {
    const navigate = useNavigate();
    const auth_fetch = useAuthFetch();
    const [downloading, set_downloading] = useState(false);
    const [toggling, set_toggling] = useState(false);
    const [deleting, set_deleting] = useState(false);

    const can_edit = can_edit_prop && is_latest;
    const can_delete = can_delete_prop === true;

    /** Shared team data shape used by Edit and Fork. */
    function builder_data() {
        return {
            name: team_name,
            description,
            tags: metadata.inputs ? undefined : undefined,
            inputs: metadata.inputs,
            use_when: metadata.use_when,
            not_for: metadata.not_for,
            phases: phases.map(p => ({
                name: p.name,
                type: p.type as 'standard' | 'gate' | 'team',
                depends_on: p.depends_on || [],
                commands: p.commands,
                max_iterations: p.max_iterations,
                agent: p.agent,
                sources: p.sources,
                target_entries: p.target_entries,
                review: p.review,
                ...(p.is_support ? { is_support: true } : {}),
            })),
            roles: roles.map(r => ({ name: r.name, content: r.content_md })),
            agents: agents
                ? Object.entries(agents).map(([name, def]) => ({
                    name,
                    entry: def.entry,
                    env: def.env,
                }))
                : [],
        };
    }

    function handle_edit() {
        const data = normalize_builder_team({ ...builder_data(), version });
        if (!data) return;
        sessionStorage.setItem(BUILDER_SESSION_KEYS.view, JSON.stringify(data));
        const from = encodeURIComponent(window.location.pathname);
        navigate(`/builder?view=1&tab=yaml&from=${from}`);
    }

    function handle_fork() {
        const data = normalize_builder_team({ ...builder_data(), name: `${team_name}-fork` });
        if (!data) return;
        sessionStorage.setItem(BUILDER_SESSION_KEYS.fork, JSON.stringify(data));
        const from = encodeURIComponent(window.location.pathname);
        navigate(`/builder?fork=1&from=${from}`);
    }

    async function handle_download() {
        set_downloading(true);
        try {
            const export_data: ExportTeamData = {
                name: team_name,
                description,
                ...metadata,
                phases: phases.map(p => ({
                    name: p.name,
                    type: p.type,
                    depends_on: p.depends_on || [],
                    commands: p.commands,
                    max_iterations: p.max_iterations,
                    agent: p.agent,
                    sources: p.sources,
                    target_entries: p.target_entries as ExportPhase['target_entries'],
                    review: p.review,
                    ...(p.is_support ? { is_support: true } : {}),
                })),
                roles: roles.map(r => ({ name: r.name, content: r.content_md })),
                agents: Object.entries(agents).map(([name, def]) => ({ name, ...def })),
            };
            const blob = await generate_team_zip(export_data);
            const suffix = version ? `-${version}` : '';
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${team_name}${suffix}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } finally {
            set_downloading(false);
        }
    }

    /** Parse scope/name from the display team_name (e.g. "@cliq/hello-world"). */
    function _parse_team_ref(): { scope?: string; name: string } {
        const match = team_name.match(/^@?([^/]+)\/(.+)$/);
        if (match) return { scope: match[1], name: match[2] };
        return { name: team_name };
    }

    async function handle_toggle_listing() {
        const ref = _parse_team_ref();
        if (!confirm(`${listed ? 'Unlist' : 'List'} "${team_name}"?`)) return;
        set_toggling(true);
        try {
            const res = await auth_fetch(listed ? '/v1/teams/unpublish' : '/v1/teams/publish', {
                method: 'POST',
                body: JSON.stringify(
                    listed
                        ? { name: ref.name, scope: ref.scope }
                        : { name: ref.name, scope: ref.scope, visibility: 'public' },
                ),
            });
            const data = await res.json();
            if (!data.ok) return;
            on_mutate?.();
        } finally {
            set_toggling(false);
        }
    }

    async function handle_delete() {
        const ref = _parse_team_ref();
        if (!confirm(`Delete "${team_name}"? This will remove it from the registry and all realms.`)) return;
        set_deleting(true);
        try {
            const res = await auth_fetch('/v1/teams/delete', {
                method: 'POST',
                body: JSON.stringify({ name: ref.name, scope: ref.scope }),
            });
            const data = await res.json();
            if (!data.ok) return;
            navigate('/teams');
        } finally {
            set_deleting(false);
        }
    }

    if (labeled) {
        const btn =
            'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';
        return (
            <div className={className ?? 'flex flex-wrap items-center gap-2'}>
                {can_edit ? (
                    <button type="button" onClick={handle_edit} className={btn}>
                        Edit
                    </button>
                ) : null}
                <button type="button" onClick={handle_fork} className={btn}>
                    Fork
                </button>
                <button
                    type="button"
                    onClick={() => void handle_download()}
                    disabled={downloading}
                    className={btn}
                >
                    {downloading ? 'Downloading…' : 'Download'}
                </button>
                {can_toggle_listing ? (
                    <button
                        type="button"
                        onClick={() => void handle_toggle_listing()}
                        disabled={toggling}
                        className={btn}
                    >
                        {toggling ? '…' : listed ? 'Unlist' : 'List'}
                    </button>
                ) : null}
                {can_delete ? (
                    <button
                        type="button"
                        onClick={() => void handle_delete()}
                        disabled={deleting}
                        className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-slate-900 dark:text-red-400"
                    >
                        {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                ) : null}
            </div>
        );
    }

    return (
        <div className={className ?? 'flex items-center gap-2'}>
            {can_edit ? (
                <button
                    type="button"
                    onClick={handle_edit}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    title="Edit YAML in builder"
                >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                </button>
            ) : null}

            <button
                type="button"
                onClick={handle_fork}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                title="Fork"
            >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7a3 3 0 100-6 3 3 0 000 6zm10 0a3 3 0 100-6 3 3 0 000 6zM7 7v4a2 2 0 002 2h6a2 2 0 002-2V7M12 13v4a3 3 0 11-6 0" />
                </svg>
            </button>

            <button
                type="button"
                onClick={() => void handle_download()}
                disabled={downloading}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
                title={downloading ? 'Downloading...' : 'Download'}
            >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
                </svg>
            </button>
        </div>
    );
}
