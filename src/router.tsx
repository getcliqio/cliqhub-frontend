import { createBrowserRouter, Navigate, useParams, useSearchParams } from 'react-router';
import { lazy_route } from '@/lib/lazy_route';
import { RootLayout } from '@/layouts/root_layout';
import { Marketplace_layout } from '@/layouts/marketplace_layout';
import { GraphiteLayout } from '@/layouts/graphite_layout';
import { GraphiteAdminLayout } from '@/layouts/graphite_admin_layout';
import { Realm_runtime_redirect } from '@/pages/account/realm_runtime_redirect';
import { use_overview } from '@/lib/overview';

function Legacy_account_team_redirect() {
  const { scope = '_', name = '' } = useParams();
  return <Navigate to={`/teams/${scope}/${name}`} replace />;
}

function Legacy_org_redirect() {
  const { id = '' } = useParams();
  return <Navigate to={`/orgs/${id}`} replace />;
}

function Legacy_browse_scope_redirect() {
  const { slug = '' } = useParams();
  return <Navigate to={`/browse/s/${slug}`} replace />;
}

/**
 * `/o/:org/realms/:realm/runs/:run_id/live` → `…/runs/:run_id?tab=dag`
 *
 * Preserves any existing bookmarks pointing at the old "live execution"
 * page — the DAG is now a tab on the unified run detail page. Deep-link
 * lands users on the DAG tab so they see the same content they were
 * looking for pre-unification.
 */
function Legacy_live_redirect() {
  return <Navigate to={{ pathname: '..', search: '?tab=dag' }} relative="path" replace />;
}

/** Old realm settings / channels URLs → `…/settings?section=` or the Notifications center. */
function Realm_settings_redirect({ to }: { to: 'members' | 'tokens' | 'a2a' | 'danger' | 'notifications' }) {
  const { org = '', slug = '' } = useParams();
  if (to === 'notifications') return <Navigate to={`/notifications?org=${encodeURIComponent(org)}`} replace />;
  const q = to === 'members' ? '' : `?section=${to}`;
  return <Navigate to={`/o/${encodeURIComponent(org)}/realms/${encodeURIComponent(slug)}/settings${q}`} replace />;
}

function Realm_team_redirect() {
  const { org = '', slug = '', scope = '_', name = '' } = useParams();
  const overview = use_overview(0);
  if (!overview.data && overview.status !== 'error') return null;
  const realm = overview.data?.orgs.find((o) => o.slug === org)?.realms.find((r) => r.slug === slug);
  const q = realm ? `?tab=runs&realm=${encodeURIComponent(realm.id)}` : '';
  return <Navigate to={`/teams/${encodeURIComponent(scope)}/${encodeURIComponent(name)}${q}`} replace />;
}

function Draft_redirect() {
  const { id = '' } = useParams();
  return <Navigate to={`/builder?draft=${encodeURIComponent(id)}`} replace />;
}

function Account_to_settings_redirect() {
  const [params] = useSearchParams();
  const q = params.toString();
  return <Navigate to={q ? `/settings?${q}` : '/settings'} replace />;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    HydrateFallback: () => null,
    children: [
      {
        index: true,
        lazy: lazy_route(() => import('@/pages/home_page')),
      },
      {
        path: 'login',
        lazy: lazy_route(() => import('@/pages/login_page')),
      },
      {
        path: 'signup',
        lazy: lazy_route(() => import('@/pages/signup_page')),
      },
      {
        path: 'invite/:token',
        lazy: lazy_route(() => import('@/pages/invite_page')),
      },
      {
        path: 'realm-invite/:token',
        lazy: lazy_route(() => import('@/pages/invite_page')),
      },
      {
        path: 'reset/:token',
        lazy: lazy_route(() => import('@/pages/reset_page')),
      },
      {
        path: 'forgot-password',
        lazy: lazy_route(() => import('@/pages/forgot_password_page')),
      },

      // Marketplace (Graphite): app shell when signed in, public frame when not
      {
        element: <Marketplace_layout />,
        children: [
          {
            path: 'browse',
            lazy: lazy_route(() => import('@/pages/teams/teams_page')),
          },
          {
            path: 'browse/s/:slug',
            lazy: lazy_route(() => import('@/pages/teams/scope_teams_page')),
          },
          {
            path: 'browse/:scope/:name',
            lazy: lazy_route(() => import('@/pages/teams/team_detail_page')),
          },
        ],
      },

      // Authenticated Graphite surfaces (own shell; migrated page by page)
      {
        element: <GraphiteLayout />,
        children: [
          {
            path: 'home',
            lazy: lazy_route(() => import('@/pages/overview_page')),
          },
          {
            path: 'getting-started',
            lazy: lazy_route(() => import('@/pages/getting_started_graphite_page')),
          },
          {
            // Build › Teams: your teams, phase shape, where they're installed (BFF composition).
            path: 'teams',
            lazy: lazy_route(() => import('@/pages/teams/teams_graphite_page')),
          },
          {
            // One team: Overview · Workflow · Files | Runs · Installs | Versions · Settings.
            path: 'teams/:scope/:name',
            lazy: lazy_route(() => import('@/pages/teams/team_graphite_page')),
          },
          {
            // HUGs: reviews + input requests waiting on a person, and past ones.
            path: 'hugs',
            lazy: lazy_route(() => import('@/pages/hugs_page')),
          },
          {
            // System events for the org (HUGs excluded).
            path: 'inbox',
            lazy: lazy_route(() => import('@/pages/inbox_page')),
          },
          {
            // Org → realm → team notification rules and channels (BFF composition).
            path: 'notifications',
            lazy: lazy_route(() => import('@/pages/notification_center_page')),
          },
          {
            // Realm home. `/o/:org/realms/:slug` (index) redirects here.
            path: 'o/:org/realms/:slug/inbox',
            lazy: lazy_route(() => import('@/pages/realm/realm_inbox_page')),
          },
          {
            // Realm runs list (BFF-paged).
            path: 'o/:org/realms/:slug/runs',
            lazy: lazy_route(() => import('@/pages/realm/realm_runs_page')),
          },
          {
            // Realm teams (BFF-paged, coverage + updates).
            path: 'o/:org/realms/:slug/teams',
            lazy: lazy_route(() => import('@/pages/realm/realm_teams_graphite_page')),
          },
          {
            // Realm daemons (status, running, teams ready).
            path: 'o/:org/realms/:slug/daemons',
            lazy: lazy_route(() => import('@/pages/realm/realm_daemons_graphite_page')),
          },
          {
            // Realm settings: general, members, access tokens, danger zone (?section=).
            path: 'o/:org/realms/:slug/settings',
            lazy: lazy_route(() => import('@/pages/realm/realm_settings_graphite_page')),
          },
          {
            // Manage › Agents: org defaults, realm overrides at a glance, who uses what, register.
            path: 'agents',
            lazy: lazy_route(() => import('@/pages/agents/agents_page')),
          },
          {
            path: 'agents/:id',
            lazy: lazy_route(() => import('@/pages/agents/agent_page')),
          },
          {
            // Realm › Agents (and one agent's realm overrides).
            path: 'o/:org/realms/:slug/agents',
            lazy: lazy_route(() => import('@/pages/realm/realm_agents_page')),
          },
          {
            path: 'o/:org/realms/:slug/agents/:id',
            lazy: lazy_route(() => import('@/pages/realm/realm_agents_page')),
          },
          {
            // Realms by org with daemon health (from the overview read) + New realm wizard (?new=1).
            path: 'realms',
            lazy: lazy_route(() => import('@/pages/realms/realms_page')),
          },
          {
            // Your account: profile, password, access tokens, your scopes (?tab=).
            path: 'settings',
            lazy: lazy_route(() => import('@/pages/settings/settings_page')),
          },
          {
            // Manage › Organization: members, roles, scopes, integrations, A2A, settings (?tab=).
            path: 'orgs/:id',
            lazy: lazy_route(() => import('@/pages/org/org_page')),
          },
          {
            // Manage › Organization without an id: one org → it; several → a chooser.
            path: 'org',
            lazy: lazy_route(() => import('@/pages/org/org_resolver_page')),
          },
          {
            // HUG review packet (markdown, form, artifacts, chat).
            path: 'reviews/:review_id',
            lazy: lazy_route(() => import('@/pages/reviews/review_page')),
          },
          {
            // Build › New team: generate, template, fork, import; canvas · YAML · changes; publish.
            path: 'builder',
            lazy: lazy_route(() => import('@/pages/builder/builder_graphite_page')),
          },
          {
            // A team in a realm → the Graphite team page, runs filtered to that realm.
            path: 'o/:org/realms/:slug/teams/:scope/:name',
            element: <Realm_team_redirect />,
          },
          {
            // Realm › Daemon: installed teams, workspaces, runs.
            path: 'o/:org/realms/:slug/daemons/:daemon_id',
            lazy: lazy_route(() => import('@/pages/realm/daemon_graphite_page')),
          },
          {
            // Realm › Workspace: teams set up there, run a team, runs.
            path: 'o/:org/realms/:slug/workspaces/:workspace_id',
            lazy: lazy_route(() => import('@/pages/realm/workspace_graphite_page')),
          },
          {
            // Run detail: phases, timeline, usage, DAG, logs.
            path: 'o/:org/realms/:slug/runs/:run_id',
            lazy: lazy_route(() => import('@/pages/realm/run_detail_page')),
          },
        ],
      },

      // Old URLs → their Graphite homes
      {
        children: [
          {
            // Drafts open in the builder.
            path: 'drafts/:id',
            element: <Draft_redirect />,
          },
          {
            path: 'bundles',
            element: <Navigate to="/teams" replace />,
          },
          {
            path: 'scopes',
            element: <Navigate to="/settings?tab=scopes" replace />,
          },
          {
            path: 'o/:org/realms/:slug',
            children: [
              {
                index: true,
                element: <Navigate to="inbox" replace />,
              },
              // Old realm settings URLs → the Graphite settings page (or Notifications).
              { path: 'channels', element: <Realm_settings_redirect to="notifications" /> },
              { path: 'notifications', element: <Realm_settings_redirect to="notifications" /> },
              { path: 'settings/security', element: <Realm_settings_redirect to="members" /> },
              { path: 'settings/security/members', element: <Realm_settings_redirect to="members" /> },
              { path: 'settings/security/tokens', element: <Realm_settings_redirect to="tokens" /> },
              { path: 'settings/a2a', element: <Realm_settings_redirect to="a2a" /> },
              { path: 'settings/danger', element: <Realm_settings_redirect to="danger" /> },
              { path: 'settings/notifications', element: <Realm_settings_redirect to="notifications" /> },
              { path: 'settings/notifications/channels', element: <Realm_settings_redirect to="notifications" /> },
              { path: 'settings/notifications/bindings', element: <Realm_settings_redirect to="notifications" /> },
              { path: 'security', element: <Realm_settings_redirect to="members" /> },
              { path: 'security/members', element: <Realm_settings_redirect to="members" /> },
              { path: 'security/tokens', element: <Realm_settings_redirect to="tokens" /> },
              { path: 'notifications/bindings', element: <Realm_settings_redirect to="notifications" /> },
              { path: 'settings/users', element: <Realm_settings_redirect to="members" /> },
              { path: 'settings/tokens', element: <Realm_settings_redirect to="tokens" /> },
              { path: 'settings/bindings', element: <Realm_settings_redirect to="notifications" /> },
              { path: 'settings/keys', element: <Realm_settings_redirect to="members" /> },
              { path: 'users', element: <Realm_settings_redirect to="members" /> },
              { path: 'tokens', element: <Realm_settings_redirect to="tokens" /> },
              { path: 'keys', element: <Realm_settings_redirect to="members" /> },
              { path: 'bindings', element: <Realm_settings_redirect to="notifications" /> },
              {
                path: 'workspaces',
                element: <Navigate to="../daemons" replace />,
              },
              {
                // Legacy /runs/:id/live URL — the DAG now lives inline on
                // the run detail page as a "DAG" tab (deep-linkable via
                // ?tab=dag). Preserve old bookmarks and open the DAG tab.
                path: 'runs/:run_id/live',
                element: <Legacy_live_redirect />,
              },
              {
                path: 'logs',
                element: <Navigate to="../runs" replace />,
              },
            ],
          },
          {
            path: 'tokens',
            element: <Navigate to="/settings?tab=tokens" replace />,
          },
          {
            // JIRA Forge integration → Manage › Organization › Integrations.
            path: 'settings/integrations/jira',
            element: <Navigate to="/org?tab=integrations" replace />,
          },
          {
            path: 'daemons',
            element: <Realm_runtime_redirect section="daemons" />,
          },
          {
            path: 'runs',
            element: <Realm_runtime_redirect section="runs" />,
          },
          {
            path: 'runs/:run_id',
            element: <Realm_runtime_redirect section="runs" />,
          },
          {
            path: 'logs',
            element: <Realm_runtime_redirect section="logs" />,
          },
          {
            // Events live in the Inbox; reviews in HUGs.
            path: 'events',
            element: <Navigate to="/inbox" replace />,
          },
          {
            path: 'hug',
            element: <Navigate to="/hugs" replace />,
          },
          {
            path: 'reviews',
            element: <Navigate to="/hugs" replace />,
          },
          {
            // Discoverable second entry for the personal "Access" tab
            // (API tokens etc.). The tab lives inside /settings, but
            // this alias exists so nav, docs, and 3rd-party links can
            // deep-link to a stable URL that reads like what it does.
            path: 'settings/access',
            element: <Navigate to="/settings?tab=tokens" replace />,
          },
          {
            path: 'account',
            element: <Account_to_settings_redirect />,
          },
          {
            // Old org list URLs → Manage › Organization (chooser when you're in several).
            path: 'organizations',
            element: <Navigate to="/org" replace />,
          },
          {
            path: 'orgs',
            element: <Navigate to="/org" replace />,
          },
        ],
      },

      // Admin
      {
        path: 'admin',
        element: <GraphiteAdminLayout />,
        children: [
          { index: true, lazy: lazy_route(() => import('@/pages/admin/graphite/admin_home_page')) },
          { path: 'accounts', lazy: lazy_route(() => import('@/pages/admin/graphite/accounts_page')) },
          { path: 'users', element: <Navigate to="/admin/accounts" replace /> },
          { path: 'orgs', lazy: lazy_route(() => import('@/pages/admin/graphite/orgs_page')) },
          { path: 'orgs/:id', lazy: lazy_route(() => import('@/pages/admin/graphite/org_page')) },
          { path: 'daemons', lazy: lazy_route(() => import('@/pages/admin/graphite/daemons_page')) },
          { path: 'teams', lazy: lazy_route(() => import('@/pages/admin/graphite/catalog_teams_page')) },
          { path: 'audit', lazy: lazy_route(() => import('@/pages/admin/graphite/audit_page')) },
          { path: 'realms', lazy: lazy_route(() => import('@/pages/admin/graphite/realms_page')) },
          { path: 'workspaces', lazy: lazy_route(() => import('@/pages/admin/graphite/workspaces_page')) },
          { path: 'runs', lazy: lazy_route(() => import('@/pages/admin/graphite/runs_page')) },
          { path: 'logs', lazy: lazy_route(() => import('@/pages/admin/graphite/logs_page')) },
          { path: 'scopes', lazy: lazy_route(() => import('@/pages/admin/graphite/scopes_page')) },
          // One team: the Graphite team page (admins can open any team there).
          { path: 'teams/:scope/:name', element: <Legacy_account_team_redirect /> },
        ],
      },


      // Legacy permanent redirects (bookmarks / old docs)
      { path: 'account/settings', element: <Navigate to="/settings?tab=profile" replace /> },
      { path: 'account/tokens', element: <Navigate to="/settings?tab=tokens" replace /> },
      { path: 'account/scopes', element: <Navigate to="/settings?tab=scopes" replace /> },
      { path: 'account/teams', element: <Navigate to="/teams" replace /> },
      { path: 'account/teams/:scope/:name', element: <Legacy_account_team_redirect /> },
      { path: 'account/orgs', element: <Navigate to="/realms" replace /> },
      {
        path: 'account/notification-channels',
        element: <Navigate to="/notifications" replace />,
      },
      { path: 'account/orgs/:id', element: <Legacy_org_redirect /> },
      { path: 'account/realms', element: <Navigate to="/realms" replace /> },
      {
        path: 'account/realms/get_by_id',
        lazy: lazy_route(() => import('@/pages/account/realm_legacy_redirect')),
      },
      { path: 'account/daemons', element: <Navigate to="/daemons" replace /> },
      { path: 'teams/s/:slug', element: <Legacy_browse_scope_redirect /> },

      {
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
]);
