import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router';
import { useOrgFetch } from '@/lib/org_context';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import type { BreadcrumbItem } from '@/components/ui/breadcrumbs';
import { TeamDetailView } from '@/components/team_detail_view';
import type { TeamDetailData } from '@/components/team_detail_view';
import { InstallToRealmDialog } from '@/components/install_to_realm_dialog';
import { TeamActions } from '@/components/team_actions';
import type { Realm_outlet_context } from '@/layouts/realm_layout';
import type { WorkflowPhase } from '@/lib/types';

/**
 * Unified team detail page — adapts breadcrumbs and actions based on
 * whether it is rendered inside a realm layout (outlet context present)
 * or as a standalone global page.
 */
export function Component() {
    const { scope = '_', name = '' } = useParams();
    const [search_params] = useSearchParams();
    const api_fetch = useOrgFetch();
    const [data, set_data] = useState<TeamDetailData | null>(null);
    const [loading, set_loading] = useState(true);
    const [install_open, set_install_open] = useState(false);

    /** Registered agent names for the org — used to flag unregistered agents. */
    const [registered_agents, set_registered_agents] = useState<Set<string> | undefined>(undefined);

    /* Realm context — present only when rendered inside RealmLayout. */
    let realm_ctx: Realm_outlet_context | null = null;
    try {
        realm_ctx = useOutletContext<Realm_outlet_context>();
    } catch {
        /* Not inside a RealmLayout — global context. */
    }

    const target_version = search_params.get('v') || undefined;
    const scope_label = scope === '_' ? null : scope;

    const load_data = useCallback(() => {
        set_loading(true);
        api_fetch('/v1/teams/get_by_id', {
            method: 'POST',
            body: JSON.stringify({
                scope: scope_label,
                name,
                version: target_version,
            }),
        })
            .then((res) => res.json())
            .then((d) => {
                if (d.ok) set_data(d.data);
            })
            .finally(() => set_loading(false));
    }, [api_fetch, scope_label, name, target_version]);

    useEffect(() => {
        void load_data();
    }, [load_data]);

    /** Fetch org's registered agents once to power the "Unregistered" badge. */
    useEffect(() => {
        api_fetch('/v1/agents/get_settings', {
            method: 'POST',
            body: JSON.stringify({}),
        })
            .then((res) => res.json())
            .then((d) => {
                if (d.ok && Array.isArray(d.agents)) {
                    set_registered_agents(new Set(d.agents.map((a: { name: string }) => a.name)));
                }
            })
            .catch(() => { /* best-effort */ });
    }, [api_fetch]);

    const all_phases: WorkflowPhase[] = useMemo(() => {
        if (!data) return [];
        return [
            ...(data.workflow?.phases || []),
            ...((data.workflow?.support || []).map((p) => ({ ...p, is_support: true }))),
        ];
    }, [data]);

    const back_href = realm_ctx ? `${realm_ctx.base_path}/teams` : '/teams';

    if (loading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <p className="text-sm text-slate-400">Loading...</p>
            </div>
        );
    }
    if (!data) {
        return (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
                <p className="text-sm text-slate-400">Not found</p>
                <Link to={back_href} className="text-sm font-semibold text-indigo-700 hover:underline">
                    ← Back to Teams
                </Link>
            </div>
        );
    }

    const detail_base = realm_ctx
        ? `${realm_ctx.base_path}/teams/${scope}/${name}`
        : `/teams/${scope}/${name}`;
    const crumb_scope = data.scope || scope_label;
    const display_version = target_version ?? data.latest_version;
    const scope_prefix = crumb_scope ? `@${crumb_scope}/` : '';

    const secondary_btn =
        'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';

    /* Breadcrumbs adapt to realm vs global context. */
    const crumbs: BreadcrumbItem[] = realm_ctx
        ? [
            { label: 'Teams', to: `${realm_ctx.base_path}/teams` },
            { label: `@${crumb_scope ?? scope}/${data.name}` },
        ]
        : [
            { label: 'Teams', to: '/teams' },
            ...(crumb_scope
                ? [{ label: `@${crumb_scope}`, to: `/teams?scope=${encodeURIComponent(crumb_scope)}` }]
                : []),
            { label: data.name },
        ];

    return (
        <div>
            {/* RealmLayout renders its own breadcrumbs — only show ours in global context. */}
            {!realm_ctx ? <Breadcrumbs items={crumbs} /> : null}

            {/* Action toolbar — adapts to realm vs global context */}
            <div className="mb-6 flex flex-wrap items-center gap-2">
                {realm_ctx ? (
                    <Link to={back_href} className={secondary_btn}>
                        ← Back to realm teams
                    </Link>
                ) : (
                    <>
                        {crumb_scope ? (
                            <button
                                type="button"
                                onClick={() => set_install_open(true)}
                                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                            >
                                Install to realm
                            </button>
                        ) : null}
                        <Link to={back_href} className={secondary_btn}>
                            Back to teams
                        </Link>
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                            <TeamActions
                                labeled
                                team_name={`${scope_prefix}${data.name}`}
                                description={data.description}
                                version={display_version ?? undefined}
                                is_latest={display_version === data.latest_version}
                                can_edit={data.can_edit}
                                can_delete={data.can_delete}
                                can_toggle_listing={data.can_toggle_listing}
                                listed={data.listed}
                                phases={all_phases}
                                roles={data.roles}
                                agents={data.agents}
                                metadata={{
                                    inputs: data.inputs,
                                    use_when: data.use_when,
                                    not_for: data.not_for,
                                }}
                                on_mutate={() => void load_data()}
                            />
                        </div>
                    </>
                )}
            </div>

            <TeamDetailView
                data={data}
                base_path={detail_base}
                display_version={display_version}
                hide_actions
                registered_agents={registered_agents}
            />

            {install_open && crumb_scope && !realm_ctx ? (
                <InstallToRealmDialog
                    scope={crumb_scope}
                    slug={data.name}
                    version={display_version ?? undefined}
                    on_close={() => set_install_open(false)}
                />
            ) : null}
        </div>
    );
}
