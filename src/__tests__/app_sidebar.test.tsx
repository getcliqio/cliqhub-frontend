import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppSidebar } from '@/components/app_sidebar';
import { AuthProvider } from '@/lib/auth_context';
import { OrgProvider } from '@/lib/org_context';

const MOCK_ADMIN = {
  ok: true,
  data: {
    user: { id: 1, username: 'admin', display_name: 'Admin', email: 'admin@test.com', role: 'admin' },
    scopes: [],
  },
};

const MOCK_MEMBER = {
  ok: true,
  data: {
    user: { id: 2, username: 'testuser', display_name: 'Test User', email: 'user@test.com', role: 'user' },
    scopes: [],
  },
};

/** Mock response for /v1/orgs/get — single personal org so no org switcher. */
function orgs_response(user: { id: number; username: string }) {
  return {
    ok: true,
    data: {
      orgs: [{ id: user.id, slug: user.username, display_name: user.username }],
    },
  };
}

async function render_sidebar(me: typeof MOCK_ADMIN, path = '/teams') {
  const user = me.data.user;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/v1/orgs/get')) {
      return new Response(JSON.stringify(orgs_response(user)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(me), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <OrgProvider>
          <AppSidebar />
        </OrgProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText(`@${me.data.user.username}`)).toBeInTheDocument());
}

describe('AppSidebar', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders slim primary nav without notifications (bell is top bar)', async () => {
    await render_sidebar(MOCK_ADMIN);
    expect(document.querySelector('a[href="/home"]')).toBeTruthy();
    // Returning users: Getting started demoted to footer (no HubActivity → not getting started)
    expect(document.querySelector('nav a[href="/getting-started"]')).toBeNull();
    expect(document.querySelector('a[href="/getting-started"]')).toBeTruthy();
    expect(document.querySelector('a[href="/teams"]')).toBeTruthy();
    expect(document.querySelector('a[href="/realms"]')).toBeTruthy();
    expect(document.querySelector('a[href="/events"]')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'HUGs and Events' })).toBeTruthy();
    expect(document.querySelector('a[href="/settings"]')).toBeTruthy();
    // Organizations retired from user-facing primary nav (2026-09-08) —
    // the concept lives on as a token/permission scope internally but
    // users work in terms of realms. Site-admin nav still shows an
    // "Organizations" link (asserted separately below).
    const nav_org_links = [...document.querySelectorAll('nav a[href="/organizations"]')];
    expect(nav_org_links).toHaveLength(0);
    expect(document.querySelector('a[href="/notifications"]')).toBeNull();
    expect(document.querySelector('a[href="/account"]')).toBeNull();
    // /browse is a footer link (Marketplace); it must not appear in the primary <nav>.
    expect(document.querySelector('nav a[href="/browse"]')).toBeNull();
    expect(document.querySelector('a[href="/builder"]')).toBeNull();
    expect(document.querySelector('a[href="/reviews"]')).toBeNull();
    expect(document.querySelector('a[href="/daemons"]')).toBeNull();
    expect(document.querySelector('a[href="/runs"]')).toBeNull();
    expect(document.querySelector('a[href="/logs"]')).toBeNull();
    expect(document.querySelector('a[href="/bundles"]')).toBeNull();
  });

  it('highlights Realms when viewing nested daemons/runs/logs', async () => {
    await render_sidebar(MOCK_ADMIN, '/realms/r-demo/daemons');
    const realms_link = document.querySelector('a[href="/realms"]');
    expect(realms_link?.className).toContain('bg-indigo-50');
  });

  it('highlights HUGs and Events when viewing reviews detail path', async () => {
    await render_sidebar(MOCK_ADMIN, '/reviews/abc');
    const hug_link = document.querySelector('a[href="/events"]');
    expect(hug_link?.className).toContain('bg-indigo-50');
  });

  it('no longer highlights any primary-nav item on /orgs/:id (org detail is admin/legacy)', async () => {
    // Regression pin for the org retirement: the /orgs/:id page still
    // exists (admin flows + old invite emails link there) but there is
    // no user-facing nav entry that should light up when a user lands
    // on it. If a future refactor accidentally re-adds an
    // "Organizations" primary link, this test will start failing.
    await render_sidebar(MOCK_ADMIN, '/orgs/42');
    expect(document.querySelector('nav a[href="/organizations"]')).toBeNull();
  });

  it('highlights Settings when viewing legacy /account path', async () => {
    await render_sidebar(MOCK_ADMIN, '/account?tab=profile');
    const settings_link = document.querySelector('a[href="/settings"]');
    expect(settings_link?.className).toContain('bg-indigo-50');
  });

  it('shows site Admin block only for platform admins', async () => {
    await render_sidebar(MOCK_ADMIN);
    expect(screen.getByText('Site Admin')).toBeInTheDocument();
    expect(document.querySelector('a[href="/admin"]')).toBeNull();
    expect(document.querySelector('a[href="/admin/accounts"]')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Users' })).toBeTruthy();
    expect(document.querySelector('a[href="/admin/orgs"]')).toBeTruthy();
    const org_links = screen.getAllByRole('link', { name: 'Organizations' });
    expect(org_links.length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('a[href="/admin/teams"]')).toBeTruthy();
    expect(document.querySelector('a[href="/admin/audit"]')).toBeTruthy();
    expect(document.querySelector('a[href="/admin/users"]')).toBeNull();
    expect(document.querySelector('a[href="/admin/scopes"]')).toBeNull();
    expect(document.querySelector('a[href="/admin/tokens"]')).toBeNull();
    expect(document.querySelector('a[href="/admin/realms"]')).toBeNull();
  });

  it('hides site Admin block for members', async () => {
    await render_sidebar(MOCK_MEMBER);
    expect(screen.queryByText('Site Admin')).toBeNull();
    expect(document.querySelector('a[href="/admin/accounts"]')).toBeNull();
  });

  it('links to documentation from the sidebar footer', async () => {
    await render_sidebar(MOCK_ADMIN);
    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
      'href',
      'https://docs.getcliq.io/',
    );
  });
});
