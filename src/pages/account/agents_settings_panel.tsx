import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Search as SearchIcon } from 'lucide-react';
import { useOrgFetch } from '@/lib/org_context';
import { AgentIcon } from '@/components/agent_icon';
import { agent_display_name } from '@/lib/agent_display';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { Pagination, PAGE_LIMIT } from '@/components/pagination';
import {
    Agent_manifest_details,
    type Manifest_input_spec,
    type Manifest_output,
} from '@/components/agent_manifest_details';
import {
    build_agents_list_params,
    filter_agents_by_query,
    normalize_agents_limit,
    normalize_agents_offset,
    page_agents,
} from '@/lib/agents_list_filters';
import { setting_applies } from '@/lib/setting_when';
import { hub_list, hub_payload } from '@/lib/hub_envelope';

interface Setting_entry {
    key: string;
    description?: string | null;
    default?: unknown;
    when?: Record<string, string>;
}

interface Agent_registry_entry {
    name: string;
    version: string | null;
    min_cliq_version?: string | null;
    description: string | null;
    capabilities: string[];
    binaries: string[];
    env?: string[];
    settings: {
        required: Setting_entry[];
        optional: Setting_entry[];
    };
    inputs?: Manifest_input_spec[];
    output?: Manifest_output | null;
}

interface Agent_summary {
    name: string;
    version: string | null;
    description: string | null;
    is_system: boolean;
    required_total: number;
    required_configured: number;
    optional_total: number;
    optional_configured: number;
    all_required_configured: boolean;
}

interface Agent_detail extends Agent_registry_entry {
    values: Record<string, string>;
    configured: Record<string, boolean>;
}

interface Setting_row {
    entry: Setting_entry;
    kind: 'required' | 'optional';
}

function Agent_settings_table({ name, on_back }: { name: string; on_back: () => void }) {
    const auth_fetch = useOrgFetch();
    const [detail, set_detail] = useState<Agent_detail | null>(null);
    const [values, set_values] = useState<Record<string, string>>({});
    const [original, set_original] = useState<Record<string, string>>({});
    const [loading, set_loading] = useState(true);
    const [saving, set_saving] = useState(false);
    const [error, set_error] = useState<string | null>(null);
    const [flash, set_flash] = useState<string | null>(null);

    const load = useCallback(async () => {
        set_loading(true);
        try {
            const res = await auth_fetch('/v1/agents/get_settings', {
                method: 'POST',
                body: JSON.stringify({ name }),
            });
            const data = await res.json();
            if (!data.ok) {
                set_error(data.error?.message || 'Failed to load agent');
                return;
            }
            const d = hub_payload<Agent_detail>(data);
            if (!d) {
                set_error('Failed to load agent');
                return;
            }
            set_detail(d);
            set_values({ ...d.values });
            set_original({ ...d.values });
            set_error(null);
        } catch {
            set_error('Failed to load agent');
        } finally {
            set_loading(false);
        }
    }, [auth_fetch, name]);

    useEffect(() => { void load(); }, [load]);

    const rows: Setting_row[] = detail
        ? [
            ...detail.settings.required
                .filter((entry) => setting_applies(entry, values))
                .map((entry) => ({ entry, kind: 'required' as const })),
            ...detail.settings.optional
                .filter((entry) => setting_applies(entry, values))
                .map((entry) => ({ entry, kind: 'optional' as const })),
        ]
        : [];

    const dirty_keys = rows
        .map((r) => r.entry.key)
        .filter((k) => (values[k] ?? '') !== (original[k] ?? ''));

    async function save() {
        if (!detail || dirty_keys.length === 0) return;
        set_saving(true);
        set_flash(null);
        try {
            const values_patch: Record<string, string> = {};
            const clear: string[] = [];
            for (const key of dirty_keys) {
                const new_val = values[key] ?? '';
                if (!new_val && original[key]) {
                    clear.push(key);
                    continue;
                }
                if (!new_val) continue;
                values_patch[key] = new_val;
            }
            const res = await auth_fetch('/v1/agents/update_settings', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    settings: {
                        ...(Object.keys(values_patch).length ? { values: values_patch } : {}),
                        ...(clear.length ? { clear } : {}),
                    },
                }),
            });
            const data = await res.json();
            if (!data.ok) {
                set_error(data.error?.message || 'Failed to save settings');
                return;
            }
            set_flash('Saved');
            setTimeout(() => set_flash(null), 2000);
            await load();
        } catch {
            set_error('Failed to save settings');
        } finally {
            set_saving(false);
        }
    }

    if (loading) return <p className="text-sm text-slate-400">Loading…</p>;
    if (error && !detail) {
        return <ApiErrorBanner error={error} onDismiss={() => set_error(null)} />;
    }
    if (!detail) return null;

    return (
        <div>
            <button
                type="button"
                onClick={on_back}
                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
                ← All agents
            </button>
            <div className="mt-3 mb-4 flex items-center gap-2">
                <AgentIcon name={detail.name} size={18} />
                <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                        {agent_display_name(detail.name)}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        {detail.description ?? 'Global defaults for this agent across your realms.'}
                        {detail.version ? ` · v${detail.version}` : ''}
                    </p>
                </div>
            </div>

            <ApiErrorBanner error={error} onDismiss={() => set_error(null)} className="mb-3" />

            {rows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-800">
                    This agent has no configurable settings.
                </p>
            ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left text-xs">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                                <th className="px-3 py-2 font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Setting</th>
                                <th className="w-24 px-3 py-2 font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Kind</th>
                                <th className="px-3 py-2 font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Value</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {rows.map(({ entry, kind }) => (
                                <tr key={entry.key} className="align-top">
                                    <td className="px-3 py-2.5">
                                        <p className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                                            {entry.key}
                                        </p>
                                        {entry.description ? (
                                            <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                                                {entry.description}
                                            </p>
                                        ) : null}
                                    </td>
                                    <td className="px-3 py-2.5">
                                        {kind === 'required' ? (
                                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                                Required
                                            </span>
                                        ) : (
                                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                                Optional
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <input
                                            type="text"
                                            value={values[entry.key] ?? ''}
                                            placeholder={
                                                entry.default !== undefined && entry.default !== null
                                                    ? String(entry.default)
                                                    : (entry.description ?? `Enter ${entry.key}`)
                                            }
                                            onChange={(e) => set_values((prev) => ({
                                                ...prev,
                                                [entry.key]: e.target.value,
                                            }))}
                                            className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-800 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {rows.length > 0 ? (
                <div className="mt-3 flex items-center justify-end gap-2">
                    {flash ? (
                        <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                            {flash}
                        </span>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => void save()}
                        disabled={saving || dirty_keys.length === 0}
                        className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                    >
                        {saving
                            ? 'Saving…'
                            : dirty_keys.length === 0
                                ? 'No changes'
                                : `Save ${dirty_keys.length} change${dirty_keys.length === 1 ? '' : 's'}`}
                    </button>
                </div>
            ) : null}

            <div className="mt-6">
                <Agent_manifest_details agent={detail} />
            </div>
        </div>
    );
}

/** Reusable agent table used for both built-in and custom sections. */
function Agent_table({ rows, on_select }: { rows: Agent_summary[]; on_select: (name: string) => void }) {
    return (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
                <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                        <th className="px-3 py-2 font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Agent</th>
                        <th className="px-3 py-2 font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Description</th>
                        <th className="w-28 px-3 py-2 font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Settings</th>
                        <th className="w-24 px-3 py-2 font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rows.map((a) => (
                        <tr key={a.name} className="hover:bg-slate-50/80 dark:hover:bg-slate-900/40">
                            <td className="px-3 py-2.5">
                                <button
                                    type="button"
                                    onClick={() => on_select(a.name)}
                                    className="flex items-center gap-2 text-left font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
                                >
                                    <AgentIcon name={a.name} size={14} />
                                    {agent_display_name(a.name)}
                                    {a.version ? (
                                        <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[9px] font-normal text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                            v{a.version}
                                        </span>
                                    ) : null}
                                </button>
                            </td>
                            <td className="max-w-xs truncate px-3 py-2.5 text-slate-500 dark:text-slate-400">
                                {a.description ?? '—'}
                            </td>
                            <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">
                                {a.required_total + a.optional_total === 0
                                    ? 'None'
                                    : `${a.required_total} req · ${a.optional_total} opt`}
                            </td>
                            <td className="px-3 py-2.5">
                                {a.all_required_configured ? (
                                    <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                        Ready
                                    </span>
                                ) : (
                                    <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                        Needs setup
                                    </span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function Component() {
    const auth_fetch = useOrgFetch();
    const [agents, set_agents] = useState<Agent_summary[]>([]);
    const [loading, set_loading] = useState(true);
    const [error, set_error] = useState<string | null>(null);
    const [search_params, set_search_params] = useSearchParams();
    const selected_agent = search_params.get('agent') ?? '';
    const q_filter = search_params.get('q')?.trim() ?? '';
    const offset = normalize_agents_offset(search_params.get('offset'));
    const page_limit = normalize_agents_limit(search_params.get('limit')) ?? PAGE_LIMIT;
    const [q_draft, set_q_draft] = useState(q_filter);

    const load = useCallback(async () => {
        set_loading(true);
        try {
            const res = await auth_fetch('/v1/agents/get_settings', {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (!data.ok) {
                set_error(data.error?.message || 'Failed to load agents');
                return;
            }
            set_agents(hub_list<Agent_summary>(data, 'agents'));
            set_error(null);
        } catch {
            set_error('Failed to load agents');
        } finally {
            set_loading(false);
        }
    }, [auth_fetch]);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        set_q_draft(q_filter);
    }, [q_filter]);

    useEffect(() => {
        if (q_draft === q_filter) return;
        const t = window.setTimeout(() => {
            const next = build_agents_list_params({
                base: search_params,
                keep: ['tab'],
                q: q_draft,
                limit: page_limit,
                offset: 0,
            });
            set_search_params(next, { replace: true });
        }, 250);
        return () => window.clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce search only
    }, [q_draft, q_filter, page_limit, set_search_params]);

    function list_params(patch: { q?: string; offset?: number; limit?: number }) {
        return build_agents_list_params({
            base: search_params,
            keep: ['tab'],
            q: patch.q ?? q_filter,
            offset: patch.offset ?? offset,
            limit: patch.limit ?? page_limit,
        });
    }

    function open_agent(name: string) {
        const next = list_params({});
        next.set('agent', name);
        set_search_params(next, { replace: true });
    }

    function close_agent() {
        const next = list_params({});
        next.delete('agent');
        set_search_params(next, { replace: true });
        void load();
    }

    const filtered = useMemo(
        () => filter_agents_by_query(agents, q_filter, agent_display_name),
        [agents, q_filter],
    );
    const page_rows = useMemo(
        () => page_agents(filtered, offset, page_limit),
        [filtered, offset, page_limit],
    );
    const builtin_agents = useMemo(() => page_rows.filter((a) => a.is_system), [page_rows]);
    const custom_agents = useMemo(() => page_rows.filter((a) => !a.is_system), [page_rows]);

    if (selected_agent) {
        return <Agent_settings_table name={selected_agent} on_back={close_agent} />;
    }

    return (
        <div>
            <div className="mb-3">
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Agent settings</h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Global defaults for agent credentials. Required and optional settings are both editable.
                </p>
            </div>

            <ApiErrorBanner error={error} onDismiss={() => set_error(null)} className="mb-3" />

            <div className="mb-3 relative max-w-sm">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    value={q_draft}
                    onChange={(e) => set_q_draft(e.target.value)}
                    placeholder="Search agents…"
                    aria-label="Search agents"
                    className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-700 outline-none focus:border-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
            </div>

            {loading ? (
                <p className="text-sm text-slate-400">Loading agents…</p>
            ) : filtered.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-slate-200 py-10 text-center dark:border-slate-800">
                    <p className="text-slate-400 dark:text-slate-500">
                        {q_filter ? 'No matching agents.' : 'No agents in the catalog.'}
                    </p>
                </div>
            ) : (
                <>
                    {builtin_agents.length > 0 ? (
                        <div className="mb-6">
                            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Built-in Agents</h3>
                            <Agent_table rows={builtin_agents} on_select={open_agent} />
                        </div>
                    ) : null}
                    {custom_agents.length > 0 ? (
                        <div className="mb-4">
                            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Custom Agents</h3>
                            <Agent_table rows={custom_agents} on_select={open_agent} />
                        </div>
                    ) : null}
                    <Pagination
                        total={filtered.length}
                        offset={offset}
                        limit={page_limit}
                        on_change={(next_offset) => {
                            set_search_params(list_params({ offset: next_offset }), { replace: true });
                        }}
                        on_limit_change={(n) => {
                            set_search_params(list_params({ limit: n, offset: 0 }), { replace: true });
                        }}
                        label="agents"
                    />
                </>
            )}
        </div>
    );
}
