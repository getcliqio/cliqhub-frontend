import { createBrowserRouter, Navigate, useParams, useSearchParams } from 'react-router';
import { lazy_route } from '@/lib/lazy_route';
import { RootLayout } from '@/layouts/root_layout';
import { BrowseLayout } from '@/layouts/browse_layout';
import { AppLayout } from '@/layouts/app_layout';
import { AdminLayout } from '@/layouts/admin_layout';
import { RealmLayout } from '@/layouts/realm_layout';
import { Realm_runtime_redirect } from '@/pages/account/realm_runtime_redirect';

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
 * `/realms/:realm/runs/:run_id/live` → `/realms/:realm/runs/:run_id?tab=dag`
 *
 * Preserves any existing bookmarks pointing at the old "live execution"
 * page — the DAG is now a tab on the unified run detail page. Deep-link
 * lands users on the DAG tab so they see the same content they were
 * looking for pre-unification.
 */
function Legacy_live_redirect() {
  return <Navigate to={{ pathname: '..', search: '?tab=dag' }} relative="path" replace />;
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
        lazy: lazy_route(() => import('@/pages/invite_accept_page')),
      },
      {
        path: 'realm-invite/:token',
        lazy: lazy_route(() => import('@/pages/realm_invite_accept_page')),
      },

      // Public catalog browse (standalone layout with filter sidebar)
      {
        element: <BrowseLayout />,
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

      // Authenticated product surfaces
      {
        element: <AppLayout />,
        children: [
          {
            path: 'home',
            lazy: lazy_route(() => import('@/pages/home_dashboard_page')),
          },
          {
            path: 'builder',
            lazy: lazy_route(() => import('@/pages/builder_page')),
          },
          {
            path: 'getting-started',
            lazy: lazy_route(() => import('@/pages/getting_started_page')),
          },
          {
            path: 'teams',
            lazy: lazy_route(() => import('@/pages/account/teams_page')),
          },
          {
            path: 'drafts/:id',
            lazy: lazy_route(() => import('@/pages/account/draft_detail_page')),
          },
          {
            path: 'teams/:scope/:name',
            lazy: lazy_route(() => import('@/pages/account/team_detail_page')),
          },
          {
            path: 'bundles',
            element: <Navigate to="/teams" replace />,
          },
          {
            path: 'scopes',
            lazy: lazy_route(() => import('@/pages/account/scopes_page')),
          },
          {
            path: 'realms',
            lazy: lazy_route(() => import('@/pages/account/realms_page')),
          },
          {
            path: 'o/:org/realms/:slug',
            element: <RealmLayout />,
            children: [
              {
                index: true,
                element: <Navigate to="teams" replace />,
              },
              {
                path: 'teams',
                lazy: lazy_route(() => import('@/pages/account/realm_teams_page')),
              },
              {
                path: 'teams/:scope/:name',
                lazy: lazy_route(() => import('@/pages/account/team_detail_page')),
              },
              {
                path: 'channels',
                lazy: lazy_route(() => import('@/pages/account/realm_channels_page')),
              },
              {
                path: 'notifications',
                lazy: lazy_route(() => import('@/pages/account/realm_notifications_page')),
              },
              {
                path: 'agents',
                lazy: lazy_route(() => import('@/pages/account/realm_agent_settings_page')),
              },
              {
                path: 'settings',
                element: <Navigate to="security/members" replace />,
              },
              {
                path: 'settings/security',
                element: <Navigate to="members" replace />,
              },
              {
                path: 'settings/security/members',
                lazy: lazy_route(() => import('@/pages/account/realm_detail_page')),
              },
              {
                path: 'settings/security/tokens',
                lazy: lazy_route(() => import('@/pages/account/realm_detail_page')),
              },
              {
                path: 'settings/a2a',
                lazy: lazy_route(() => import('@/pages/account/realm_a2a_settings_page')),
              },
              {
                path: 'settings/danger',
                lazy: lazy_route(() => import('@/pages/account/realm_danger_page')),
              },
              {
                path: 'settings/notifications',
                element: <Navigate to="bindings" replace />,
              },
              {
                path: 'settings/notifications/channels',
                element: <Navigate to="../bindings" replace />,
              },
              {
                path: 'settings/notifications/bindings',
                lazy: lazy_route(() => import('@/pages/account/realm_detail_page')),
              },
              {
                path: 'security',
                element: <Navigate to="../settings/security/members" replace />,
              },
              {
                path: 'security/members',
                element: <Navigate to="../../settings/security/members" replace />,
              },
              {
                path: 'security/tokens',
                element: <Navigate to="../../settings/security/tokens" replace />,
              },
              {
                path: 'notifications/bindings',
                element: <Navigate to="../../settings/notifications/bindings" replace />,
              },
              {
                path: 'settings/users',
                element: <Navigate to="../security/members" replace />,
              },
              {
                path: 'settings/tokens',
                element: <Navigate to="../security/tokens" replace />,
              },
              {
                path: 'settings/bindings',
                element: <Navigate to="../notifications/bindings" replace />,
              },
              {
                path: 'settings/keys',
                element: <Navigate to="../security/members" replace />,
              },
              {
                path: 'users',
                element: <Navigate to="../settings/security/members" replace />,
              },
              {
                path: 'tokens',
                element: <Navigate to="../settings/security/tokens" replace />,
              },
              {
                path: 'keys',
                element: <Navigate to="../settings/security/members" replace />,
              },
              {
                path: 'bindings',
                element: <Navigate to="../settings/notifications/bindings" replace />,
              },
              {
                path: 'daemons',
                lazy: lazy_route(() => import('@/pages/account/daemons_page')),
              },
              {
                path: 'daemons/:daemon_id',
                lazy: lazy_route(() => import('@/pages/account/daemon_detail_page')),
              },
              {
                path: 'workspaces',
                element: <Navigate to="../daemons" replace />,
              },
              {
                path: 'workspaces/:workspace_id',
                lazy: lazy_route(() => import('@/pages/account/workspace_detail_page')),
              },
              {
                path: 'runs',
                lazy: lazy_route(() => import('@/pages/runs/runs_page')),
              },
              {
                path: 'runs/:run_id',
                lazy: lazy_route(() => import('@/pages/runs/run_detail_page')),
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
            lazy: lazy_route(() => import('@/pages/account/tokens_page')),
          },
          {
            // JIRA Forge integration (slice 1.7). Page itself gates on
            // VITE_ENABLE_JIRA_INTEGRATION — when the flag is off it
            // <Navigate>s to /settings, keeping the URL a soft-404.
            path: 'settings/integrations/jira',
            lazy: lazy_route(() => import('@/pages/account/jira_integration_page')),
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
            path: 'events',
            lazy: lazy_route(() => import('@/pages/events_page')),
          },
          {
            path: 'notifications',
            element: <Navigate to="/events?tab=all" replace />,
          },
          {
            path: 'hug',
            element: <Navigate to="/events?tab=hug" replace />,
          },
          {
            path: 'reviews/:review_id',
            lazy: lazy_route(() => import('@/pages/review_detail_page')),
          },
          {
            path: 'reviews',
            element: <Navigate to="/events?tab=hug" replace />,
          },
          {
            path: 'settings',
            lazy: lazy_route(() => import('@/pages/account/account_page')),
          },
          {
            // Discoverable second entry for the personal "Access" tab
            // (API tokens etc.). The tab lives inside /settings, but
            // this alias exists so nav, docs, and 3rd-party links can
            // deep-link to a stable URL that reads like what it does.
            path: 'settings/access',
            element: <Navigate to="/settings?tab=access" replace />,
          },
          {
            path: 'account',
            element: <Account_to_settings_redirect />,
          },
          {
            // Organizations was retired from user-facing nav (2026-09-08).
            // The list page is redirected to /realms so any bookmarks
            // land on the useful surface. `/orgs/:id` is still routed
            // (admin flows and legacy invite emails link to it) but
            // no longer surfaced from the sidebar.
            path: 'organizations',
            element: <Navigate to="/realms" replace />,
          },
          {
            path: 'orgs',
            element: <Navigate to="/realms" replace />,
          },
          {
            path: 'orgs/:id',
            lazy: lazy_route(() => import('@/pages/account/org_detail_page')),
          },
        ],
      },

      // Admin
      {
        path: 'admin',
        element: <AdminLayout />,
        children: [
          {
            index: true,
            element: <Navigate to="/admin/accounts" replace />,
          },
          {
            path: 'accounts',
            lazy: lazy_route(() => import('@/pages/admin/users_page')),
          },
          {
            path: 'users',
            element: <Navigate to="/admin/accounts" replace />,
          },
          {
            path: 'teams',
            lazy: lazy_route(() => import('@/pages/admin/teams_page')),
          },
          {
            path: 'teams/:scope/:name',
            lazy: lazy_route(() => import('@/pages/admin/team_detail_page')),
          },
          {
            path: 'orgs',
            lazy: lazy_route(() => import('@/pages/admin/orgs_page')),
          },
          {
            path: 'orgs/:id',
            lazy: lazy_route(() => import('@/pages/admin/org_detail_page')),
          },
          {
            path: 'realms',
            lazy: lazy_route(() => import('@/pages/admin/realms_page')),
          },
          {
            path: 'daemons',
            lazy: lazy_route(() => import('@/pages/admin/daemons_page')),
          },
          {
            path: 'workspaces',
            lazy: lazy_route(() => import('@/pages/admin/workspaces_page')),
          },
          {
            path: 'runs',
            lazy: lazy_route(() => import('@/pages/admin/runs_page')),
          },
          {
            path: 'logs',
            lazy: lazy_route(() => import('@/pages/admin/logs_page')),
          },
          {
            path: 'scopes',
            lazy: lazy_route(() => import('@/pages/admin/scopes_page')),
          },
          {
            path: 'audit',
            lazy: lazy_route(() => import('@/pages/admin/audit_page')),
          },
        ],
      },


      // Legacy permanent redirects (bookmarks / old docs)
      { path: 'account/settings', element: <Navigate to="/settings?tab=profile" replace /> },
      { path: 'account/tokens', element: <Navigate to="/tokens" replace /> },
      { path: 'account/scopes', element: <Navigate to="/scopes" replace /> },
      { path: 'account/teams', element: <Navigate to="/teams" replace /> },
      { path: 'account/teams/:scope/:name', element: <Legacy_account_team_redirect /> },
      { path: 'account/orgs', element: <Navigate to="/realms" replace /> },
      {
        path: 'account/notification-channels',
        element: <Navigate to="/settings?tab=notifications" replace />,
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
