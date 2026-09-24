import { lazy, Suspense } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { KeyRound, Settings } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { useOrg } from '@/lib/org_context';
import { PageHeader } from '@/components/ui/page_header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Component as SettingsPanel } from '@/pages/account/settings_page';
import { Channels_tab, Rules_tab } from '@/pages/account/notification_settings_page';
import { Component as AgentsSettingsPanel } from '@/pages/account/agents_settings_panel';
import { Account_mesh_settings_panel } from '@/pages/account/account_mesh_settings_panel';

const Roles_settings_panel = lazy(() => import('@/pages/account/roles_settings_panel'));
const Members_settings_panel = lazy(() => import('@/pages/account/members_settings_panel'));

/**
 * User-level settings — same regardless of which org is active.
 * "Access" was added 2026-09-08 as the discoverable home for personal
 * access tokens. Direct-URL access via /tokens still works; this tab
 * closes the discoverability gap (users looked in Settings first).
 */
const PERSONAL_TABS = [
    { id: 'profile', label: 'Profile' },
    { id: 'security', label: 'Security' },
    { id: 'access', label: 'Access' },
] as const;

/**
 * Org-scoped settings — change when you switch orgs. `integrations`
 * is only visible when at least one integration flag is on
 * (currently just `VITE_ENABLE_JIRA_INTEGRATION` for slice 1.7).
 */
const ORG_TABS = [
    { id: 'agents', label: 'Agents' },
    { id: 'channels', label: 'Channels' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'mesh', label: 'A2A' },
    { id: 'members', label: 'Members' },
    { id: 'roles', label: 'Roles' },
] as const;

function any_integration_enabled(): boolean {
    return import.meta.env.VITE_ENABLE_JIRA_INTEGRATION === 'true';
}

type PersonalTabId = (typeof PERSONAL_TABS)[number]['id'];
type OrgTabId = (typeof ORG_TABS)[number]['id'];
type TopLevel = 'personal' | 'org';

const PERSONAL_IDS = new Set<string>(PERSONAL_TABS.map(t => t.id));
const ORG_IDS = new Set<string>(ORG_TABS.map(t => t.id));

/** Members/Roles only visible in shared (non-personal) orgs. */
const SHARED_ONLY: Set<string> = new Set(['members', 'roles']);

/** Tabs that only show when their feature flag is on. */
function tab_is_flag_hidden(tab_id: string): boolean {
    if (tab_id === 'integrations') return !any_integration_enabled();
    return false;
}

function resolve_state(
    raw_tab: string | null,
    show_shared: boolean,
): { top: TopLevel; sub: PersonalTabId | OrgTabId } | { redirect: string } {
    if (raw_tab === 'organizations' || raw_tab === 'accounts') {
        // Both were legacy top-level nav tabs on the settings page.
        // The organizations concept has been folded into realms for
        // user-facing surfaces (see remove-orgs pass B). Send the
        // user to the realm list — which is where they wanted to be.
        return { redirect: '/realms' };
    }
    if (raw_tab === 'bindings') {
        return { top: 'org', sub: 'notifications' };
    }

    if (PERSONAL_IDS.has(raw_tab as string)) {
        return { top: 'personal', sub: raw_tab as PersonalTabId };
    }
    if (ORG_IDS.has(raw_tab as string)) {
        if (SHARED_ONLY.has(raw_tab as string) && !show_shared) {
            return { top: 'org', sub: 'agents' };
        }
        return { top: 'org', sub: raw_tab as OrgTabId };
    }

    return { top: 'org', sub: 'agents' };
}

function NavTab({ id, label, active }: { id: string; label: string; active: boolean }) {
    return (
        <Link
            to={`/settings?tab=${id}`}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${
                active
                    ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200'
                    : 'font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
        >
            {label}
        </Link>
    );
}

export function Component() {
    const { logout } = useAuth();
    const { is_personal, is_multi_org, current_org } = useOrg();
    const [search_params, set_search_params] = useSearchParams();

    const show_shared = is_multi_org && !is_personal;
    const state = resolve_state(search_params.get('tab'), show_shared);

    if ('redirect' in state) {
        return <Navigate to={state.redirect} replace />;
    }

    const { top, sub } = state;
    const org_name = current_org?.display_name ?? 'Organization';

    const visible_org_tabs = ORG_TABS
        .filter(t => show_shared || !SHARED_ONLY.has(t.id))
        .filter(t => !tab_is_flag_hidden(t.id));

    /** Switch between the two top-level tabs. */
    function switch_top(target: TopLevel) {
        if (target === top) return;
        const default_sub = target === 'personal' ? 'profile' : 'agents';
        set_search_params({ tab: default_sub }, { replace: true });
    }

    const active_label = top === 'personal'
        ? PERSONAL_TABS.find(t => t.id === sub)?.label ?? 'Profile'
        : ORG_TABS.find(t => t.id === sub)?.label ?? 'Agents';

    return (
        <div>
            <Breadcrumbs
                items={[
                    { label: 'Settings', to: '/settings' },
                    { label: active_label },
                ]}
            />
            <PageHeader
                icon={Settings}
                tone="slate"
                title="Settings"
                description="Your personal settings and workspace configuration."
                actions={(
                    <button
                        type="button"
                        onClick={() => void logout()}
                        className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                    >
                        Sign out
                    </button>
                )}
            />

            {/* Top-level tabs */}
            <div className="mt-4 flex gap-0 border-b border-slate-200 dark:border-slate-700">
                <button
                    type="button"
                    onClick={() => switch_top('org')}
                    className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                        top === 'org'
                            ? 'border-indigo-600 font-semibold text-indigo-700 dark:border-indigo-400 dark:text-indigo-200'
                            : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                >
                    {org_name} Settings
                </button>
                <button
                    type="button"
                    onClick={() => switch_top('personal')}
                    className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                        top === 'personal'
                            ? 'border-indigo-600 font-semibold text-indigo-700 dark:border-indigo-400 dark:text-indigo-200'
                            : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                >
                    Personal Settings
                </button>
            </div>

            {/* Sub-nav + content */}
            <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start">
                <nav className="flex shrink-0 gap-1 overflow-x-auto lg:w-44 lg:flex-col lg:overflow-visible">
                    {top === 'personal'
                        ? PERSONAL_TABS.map(t => (
                            <NavTab key={t.id} id={t.id} label={t.label} active={t.id === sub} />
                        ))
                        : visible_org_tabs.map(t => (
                            <NavTab key={t.id} id={t.id} label={t.label} active={t.id === sub} />
                        ))
                    }
                </nav>

                <div className="min-w-0 flex-1">
                    {sub === 'profile' ? <SettingsPanel section="profile" /> : null}
                    {sub === 'security' ? <SettingsPanel section="security" /> : null}
                    {sub === 'access' ? <Access_panel /> : null}
                    {sub === 'agents' ? <AgentsSettingsPanel /> : null}
                    {sub === 'channels' ? <Channels_tab /> : null}
                    {sub === 'notifications' ? <Rules_tab /> : null}
                    {sub === 'integrations' && any_integration_enabled() ? <Integrations_index /> : null}
                    {sub === 'mesh' ? <Account_mesh_settings_panel org_id={current_org?.id} /> : null}
                    {sub === 'members' && show_shared ? (
                        <Suspense fallback={<p className="text-sm text-slate-400">Loading...</p>}>
                            <Members_settings_panel />
                        </Suspense>
                    ) : null}
                    {sub === 'roles' && show_shared ? (
                        <Suspense fallback={<p className="text-sm text-slate-400">Loading...</p>}>
                            <Roles_settings_panel />
                        </Suspense>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

/**
 * Personal "Access" section — starts with API Tokens as the only
 * card. Keeps the full tokens page (`/tokens`) as the single source
 * of truth for the mint / list / revoke workflow — this card is
 * purely a discoverable entry point from Settings. Direct-URL
 * navigation to `/settings/access` also lands here (see router.tsx).
 *
 * Future additions to the same section (SSH keys, SSO devices, etc.)
 * can drop in as sibling cards without needing another top-level tab.
 */
function Access_panel() {
    return (
        <div className="grid gap-4 sm:grid-cols-2">
            <Link
                to="/tokens"
                data-testid="settings-access-tokens-card"
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow"
            >
                <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-indigo-600" aria-hidden />
                    <p className="text-sm font-bold text-slate-800">API Tokens</p>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                    Personal access tokens (<code className="rounded bg-slate-100 px-1 font-mono text-[10px]">cliq_tok_…</code>)
                    for the CLI, CI pipelines, and scripts that call the Cliq API on your behalf.
                    Mint, list, and revoke your own tokens.
                </p>
                <p className="mt-3 text-xs font-semibold text-indigo-600">Manage tokens →</p>
            </Link>
        </div>
    );
}

/**
 * Card grid listing every integration whose feature flag is on.
 * Currently one entry (JIRA); designed for straightforward extension.
 */
function Integrations_index() {
    const jira_enabled = import.meta.env.VITE_ENABLE_JIRA_INTEGRATION === 'true';
    return (
        <div className="grid gap-4 sm:grid-cols-2">
            {jira_enabled && (
                <Link
                    to="/settings/integrations/jira"
                    className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow"
                >
                    <p className="text-sm font-bold text-slate-800">Atlassian JIRA</p>
                    <p className="mt-1 text-xs text-slate-500">
                        Post Cliq run lifecycle events onto JIRA issues via a Forge app. Bind
                        one JIRA workspace per Cliq realm.
                    </p>
                    <p className="mt-3 text-xs font-semibold text-indigo-600">Manage →</p>
                </Link>
            )}
        </div>
    );
}
