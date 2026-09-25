import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import yaml from 'js-yaml';
import { useAuthFetch } from '@/lib/auth_context';
import { useOrg } from '@/lib/org_context';
import { setting_applies } from '@/lib/setting_when';
import { hub_list, hub_payload } from '@/lib/hub_envelope';

/**
 * Shared agent-check wizard for installing a team into a realm.
 *
 * Resolves the team manifest, checks agent requirements against the
 * catalog, fetches existing realm settings, and lets the user fill in
 * any missing config before confirming the install.
 */

interface Setting_req {
    key: string;
    when?: Record<string, string>;
}

interface Agent_req {
    /** Catalog UUID — used for get_settings / update_settings. */
    id: string;
    name: string;
    required: Setting_req[];
    optional: Setting_req[];
    configured: Record<string, string>;
}

export interface Install_team_wizard_props {
    scope: string;
    slug: string;
    /** When set, install this specific published version. */
    version?: string;
    realm_id: string;
    /** fetch function that injects auth + org headers */
    auth_fetch: (url: string, init?: RequestInit) => Promise<Response>;
    /** Called after successful install */
    on_done: () => void;
    /** Called when user cancels or closes */
    on_cancel: () => void;
    /** Optional back button handler (e.g. to return to realm picker) */
    on_back?: () => void;
    /** Override the header title (defaults to "Install team to realm") */
    header_title?: string;
}

function api_error_message(data: { error?: string | { message?: string } }): string {
    if (typeof data.error === 'string') return data.error;
    return data.error?.message ?? 'Request failed';
}

export function Install_team_wizard({
    scope,
    slug,
    version,
    realm_id,
    auth_fetch,
    on_done,
    on_cancel,
    on_back,
    header_title = 'Install team to realm',
}: Install_team_wizard_props) {
    const agents_fetch = useAuthFetch();
    const { current_id } = useOrg();
    const [agents, set_agents] = useState<Agent_req[]>([]);
    const [values, set_values] = useState<Record<string, Record<string, string>>>({});
    const [loading_agents, set_loading_agents] = useState(true);
    const [adding, set_adding] = useState(false);
    const [save_to_realm, set_save_to_realm] = useState(true);
    const [error, set_error] = useState<string | null>(null);

    /** Existing installed version — used for overwrite confirmation. */
    const [installed_version, set_installed_version] = useState<string | null>(null);
    const [overwrite_confirmed, set_overwrite_confirmed] = useState(false);

    /** Resolve the team manifest and check agent requirements. */
    const check_agents = useCallback(async () => {
        set_loading_agents(true);
        set_error(null);

        if (!current_id) {
            set_error('No active workspace');
            set_loading_agents(false);
            return;
        }

        try {
            /** Check if this team is already installed in the realm. */
            try {
                const list_res = await auth_fetch('/v1/teams/get', {
                    method: 'POST',
                    body: JSON.stringify({ realm_id }),
                });
                const list_data = await list_res.json();
                const teams: Array<{ slug?: string; scope?: string; version?: string }> =
                    list_data.data?.teams
                    ?? list_data.teams
                    ?? list_data.data?.rows
                    ?? list_data.rows
                    ?? [];
                const existing = teams.find(
                    (t) => t.slug === slug && (t.scope === scope || t.scope === null),
                );
                if (existing?.version) {
                    set_installed_version(existing.version);
                }
            } catch { /* best-effort — skip overwrite check */ }

            const team_res = await auth_fetch('/v1/teams/get_by_id', {
                method: 'POST',
                body: JSON.stringify({ name: slug, scope }),
            });
            const team_data = await team_res.json();

            const agents_needed = new Set<string>();

            const workflow = team_data.data?.workflow;
            if (workflow) {
                const phases: Array<{ agent?: string; type?: string }> = Array.isArray(workflow)
                    ? workflow
                    : (workflow as { phases?: unknown[] }).phases ?? [];
                for (const phase of phases) {
                    if (phase.type === 'team') continue;
                    if (phase.agent) agents_needed.add(phase.agent);
                }
            }

            const raw_manifest = team_data.data?.manifest_yaml ?? team_data.data?.manifest;
            if (agents_needed.size === 0 && typeof raw_manifest === 'string') {
                try {
                    const doc = yaml.load(raw_manifest) as { phases?: Array<{ agent?: string; type?: string }> };
                    if (doc?.phases) {
                        for (const p of doc.phases) {
                            if (p.type === 'team') continue;
                            if (p.agent) agents_needed.add(p.agent);
                        }
                    }
                } catch { /* skip */ }
            }

            if (agents_needed.size === 0) {
                set_agents([]);
                set_loading_agents(false);
                return;
            }

            const names = [...agents_needed];
            const catalog_res = await agents_fetch('/v1/agents/get', {
                method: 'POST',
                body: JSON.stringify({
                    org_id: current_id,
                    names,
                    include_manifest: true,
                }),
            });
            const catalog_data = await catalog_res.json() as {
                ok?: boolean;
                data?: Array<{
                    id: string;
                    name: string;
                    manifest?: {
                        settings?: {
                            required?: Array<string | { key: string; when?: Record<string, string> }>;
                            optional?: Array<string | { key: string; when?: Record<string, string> }>;
                        };
                    };
                }>;
            };
            if (!catalog_res.ok || catalog_data.ok === false) {
                set_error('Failed to load agent catalog');
                set_loading_agents(false);
                return;
            }
            const catalog_agents = hub_list<{
                id: string;
                name: string;
                manifest?: {
                    settings?: {
                        required?: Array<string | { key: string; when?: Record<string, string> }>;
                        optional?: Array<string | { key: string; when?: Record<string, string> }>;
                    };
                };
            }>(catalog_data, 'agents');
            const catalog_map = new Map(
                catalog_agents.map((a) => [
                    a.name,
                    {
                        id: a.id,
                        name: a.name,
                        settings: a.manifest?.settings,
                    },
                ]),
            );

            const agent_reqs: Agent_req[] = [];
            const missing_agents: string[] = [];
            for (const agent_name of agents_needed) {
                const catalog_entry = catalog_map.get(agent_name);
                if (!catalog_entry?.id) {
                    missing_agents.push(agent_name);
                    continue;
                }

                // Fetch effective values (realm override > org-level fallback)
                let configured: Record<string, string> = {};
                try {
                    const detail_res = await agents_fetch('/v1/agents/get_settings', {
                        method: 'POST',
                        body: JSON.stringify({
                            org_id: current_id,
                            id: catalog_entry.id,
                            realm_id,
                        }),
                    });
                    const detail_data = await detail_res.json();
                    configured = hub_payload<{ values?: Record<string, string> }>(detail_data)?.values
                        ?? (detail_data as { values?: Record<string, string> }).values
                        ?? {};
                } catch { /* fall through with empty */ }

                const to_entry = (s: string | { key: string; when?: Record<string, string> }): Setting_req => (
                    typeof s === 'string' ? { key: s } : { key: s.key, ...(s.when ? { when: s.when } : {}) }
                );
                const required = (catalog_entry.settings?.required ?? []).map(to_entry);
                const optional = (catalog_entry.settings?.optional ?? []).map(to_entry);
                agent_reqs.push({
                    id: catalog_entry.id,
                    name: agent_name,
                    required,
                    optional,
                    configured,
                });
            }

            if (missing_agents.length > 0) {
                set_error(
                    `Cannot install — required agents not found in the catalog: ${missing_agents.join(', ')}. ` +
                    `Custom agents must be installed locally and registered with 'cliq agent register <name>'.`,
                );
                set_loading_agents(false);
                return;
            }

            set_agents(agent_reqs);
            set_values(
                Object.fromEntries(agent_reqs.map((a) => [
                    a.name,
                    Object.fromEntries(
                        [...a.required, ...a.optional].map((s) => [s.key, a.configured[s.key] ?? '']),
                    ),
                ])),
            );
        } catch {
            set_error('Failed to load team requirements');
        } finally {
            set_loading_agents(false);
        }
    }, [auth_fetch, agents_fetch, current_id, scope, slug, realm_id]);

    useEffect(() => { void check_agents(); }, [check_agents]);

    /** Save settings, add team to realm list, dispatch install. */
    async function handle_confirm() {
        set_adding(true);
        set_error(null);

        try {
            if (save_to_realm) {
                if (!current_id) {
                    set_error('No active workspace');
                    return;
                }
                for (const [agent_name, keys] of Object.entries(values)) {
                    const values_patch: Record<string, string> = {};
                    const existing = agents.find((a) => a.name === agent_name);
                    for (const [key, value] of Object.entries(keys)) {
                        if (!value.trim()) continue;
                        if (existing?.configured[key] === value) continue;
                        values_patch[key] = value.trim();
                    }
                    if (Object.keys(values_patch).length === 0) continue;
                    if (!existing?.id) continue;
                    await agents_fetch('/v1/agents/update_settings', {
                        method: 'POST',
                        body: JSON.stringify({
                            org_id: current_id,
                            id: existing.id,
                            realm_id,
                            settings: { values: values_patch },
                        }),
                    });
                }
            }

            const agent_settings: Record<string, Record<string, string>> = {};
            for (const [agent_name, keys] of Object.entries(values)) {
                const filled: Record<string, string> = {};
                for (const [k, v] of Object.entries(keys)) {
                    if (v.trim()) filled[k] = v.trim();
                }
                if (Object.keys(filled).length > 0) agent_settings[agent_name] = filled;
            }

            const add_res = await auth_fetch('/v1/realms/add_team', {
                method: 'POST',
                body: JSON.stringify({ realm_id, scope, slug }),
            });
            const add_data = await add_res.json();
            if (!add_data.ok) {
                set_error(api_error_message(add_data));
                return;
            }

            const dispatch_body: Record<string, unknown> = {
                team_id: `${scope}/${slug}`,
                realm_id,
                agent_settings,
            };
            if (version) dispatch_body.version = version;

            void auth_fetch('/v1/teams/install', {
                method: 'POST',
                body: JSON.stringify(dispatch_body),
            }).catch(() => {});

            on_done();
        } catch {
            set_error('Failed to add team');
        } finally {
            set_adding(false);
        }
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={`Install @${scope}/${slug}`}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
            onClick={(e) => { if (e.target === e.currentTarget) on_cancel(); }}
        >
            <div className="flex max-h-[calc(100vh-4rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                {/* Header */}
                <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                        {header_title}
                    </p>
                    <p className="mt-0.5 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                        @{scope}/{slug}
                    </p>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4">
                    {loading_agents ? (
                        <p className="text-xs text-slate-400">Checking agent requirements…</p>
                    ) : agents.length === 0 ? (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-900/30">
                            <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                                No agent configuration needed
                            </p>
                            <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                                This team uses only zero-config agents. Ready to install.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                This team requires the following agents. Configure any missing settings before installing.
                            </p>
                            {agents.map((agent) => {
                                const vals = values[agent.name] ?? {};
                                const required_keys = agent.required
                                    .filter((s) => setting_applies(s, vals))
                                    .map((s) => s.key);
                                const optional_keys = agent.optional
                                    .filter((s) => setting_applies(s, vals))
                                    .map((s) => s.key);
                                const has_all = required_keys.length === 0
                                    || required_keys.every((k) => vals[k]?.trim());
                                return (
                                    <div key={agent.name} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                                        <div className="flex items-center gap-2">
                                            <span className={`h-2 w-2 rounded-full ${has_all ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                                            <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-100">
                                                {agent.name}
                                            </span>
                                            {has_all ? (
                                                <span className="ml-auto text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Configured</span>
                                            ) : (
                                                <span className="ml-auto text-[10px] font-semibold text-amber-600 dark:text-amber-400">Needs config</span>
                                            )}
                                        </div>
                                        {required_keys.length > 0 || optional_keys.length > 0 ? (
                                            <div className="mt-2 space-y-2">
                                                {required_keys.map((key) => (
                                                    <label key={key} className="block">
                                                        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{key}</span>
                                                        <input
                                                            type="text"
                                                            value={vals[key] ?? ''}
                                                            onChange={(e) => set_values((prev) => ({
                                                                ...prev,
                                                                [agent.name]: { ...prev[agent.name], [key]: e.target.value },
                                                            }))}
                                                            placeholder={key}
                                                            className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                                        />
                                                    </label>
                                                ))}
                                                {optional_keys.map((key) => (
                                                    <label key={key} className="block">
                                                        <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                                                            {key} <span className="italic">(optional)</span>
                                                        </span>
                                                        <input
                                                            type="text"
                                                            value={vals[key] ?? ''}
                                                            onChange={(e) => set_values((prev) => ({
                                                                ...prev,
                                                                [agent.name]: { ...prev[agent.name], [key]: e.target.value },
                                                            }))}
                                                            placeholder={key}
                                                            className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                                        />
                                                    </label>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="mt-1 text-[10px] text-slate-400">No settings required</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {error ? (
                        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                            {error}
                        </p>
                    ) : null}

                    {agents.some((a) => a.required.length > 0 || a.optional.length > 0) ? (
                        <label className="mt-3 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                            <input
                                type="checkbox"
                                checked={save_to_realm}
                                onChange={(e) => set_save_to_realm(e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600"
                            />
                            Save settings to realm for other teams
                        </label>
                    ) : null}

                    {/* Overwrite warning when a different version is already installed. */}
                    {installed_version && installed_version !== (version ?? installed_version) ? (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-900/30">
                            <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                                v{installed_version} is currently installed
                            </p>
                            <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                                Installing v{version} will replace the existing version.
                            </p>
                            <label className="mt-2 flex items-center gap-2 text-[11px] text-amber-800 dark:text-amber-200">
                                <input
                                    type="checkbox"
                                    checked={overwrite_confirmed}
                                    onChange={(e) => set_overwrite_confirmed(e.target.checked)}
                                    className="h-3.5 w-3.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                                />
                                I understand — replace v{installed_version} with v{version}
                            </label>
                        </div>
                    ) : null}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 dark:border-slate-800">
                    {on_back ? (
                        <button
                            type="button"
                            onClick={on_back}
                            className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                        >
                            ← Back
                        </button>
                    ) : <span />}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={on_cancel}
                            className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={adding || loading_agents || (
                                !!installed_version
                                && installed_version !== (version ?? installed_version)
                                && !overwrite_confirmed
                            )}
                            onClick={() => void handle_confirm()}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-800 disabled:opacity-60"
                        >
                            <Plus className="h-3 w-3" />
                            {adding ? 'Installing…' : 'Install'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
