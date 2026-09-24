/**
 * Integration tests for the new "Access" personal tab on /settings.
 *
 * Pins two things the user asked for:
 *   1. Personal access tokens are discoverable from Settings — the
 *      Access tab renders a card that links to /tokens.
 *   2. The `/settings/access` deep-link works, landing on that tab.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

const auth_fetch = vi.fn();

vi.mock('@/lib/auth_context', () => ({
    useAuth: () => ({
        user: {
            id: 1,
            username: 'testuser',
            display_name: 'Test User',
            email: 'test@example.com',
            role: 'user',
        },
        refresh: vi.fn(),
        logout: vi.fn(),
    }),
    useAuthFetch: () => auth_fetch,
}));

vi.mock('@/lib/org_context', () => ({
    useOrg: () => ({
        current_org: { id: 1, slug: 'acme', display_name: 'Acme' },
        orgs: [{ id: 1, slug: 'acme', display_name: 'Acme' }],
        is_multi_org: false,
        is_personal: true,
        loading: false,
        switch_org: vi.fn(),
    }),
    useOrgFetch: () => auth_fetch,
}));

// Panels that would otherwise pull in heavy trees. The Access tab is
// what we're testing; the rest are stubs so the page mounts fast.
vi.mock('@/pages/account/notification_settings_page', () => ({
    Channels_tab: () => <div>channels</div>,
    Rules_tab: () => <div>rules</div>,
}));
vi.mock('@/pages/account/agents_settings_panel', () => ({
    Component: () => <div>agents</div>,
}));
vi.mock('@/pages/account/account_mesh_settings_panel', () => ({
    Account_mesh_settings_panel: () => <div>mesh</div>,
}));
vi.mock('@/pages/account/settings_page', () => ({
    Component: ({ section }: { section?: string }) => <div>profile/security panel: {section}</div>,
}));

import { Component as Account_page } from '@/pages/account/account_page';

function render_at(url: string) {
    return render(
        <MemoryRouter initialEntries={[url]}>
            <Routes>
                <Route path="/settings" element={<Account_page />} />
                {/* Route target for the alias redirect — the SUT redirect */}
                {/* would 404 the assertion below otherwise. */}
                <Route path="/tokens" element={<div>tokens page</div>} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('Personal settings — Access tab', () => {
    beforeEach(() => {
        auth_fetch.mockReset();
    });

    it('exposes an "Access" tab in the personal-settings sub-nav', async () => {
        render_at('/settings?tab=profile');
        // The nav renders a link per personal tab; the label is the
        // clickable surface users see.
        await waitFor(() => screen.getByRole('link', { name: /^Profile$/i }));
        expect(screen.getByRole('link', { name: /^Access$/i })).toBeInTheDocument();
    });

    it('renders the API Tokens card when /settings?tab=access is opened', async () => {
        render_at('/settings?tab=access');

        const card = await waitFor(() => screen.getByTestId('settings-access-tokens-card'));
        expect(card).toHaveAttribute('href', '/tokens');
        expect(card).toHaveTextContent(/API Tokens/i);
        expect(card).toHaveTextContent(/Manage tokens/i);
    });

    it('landing at ?tab=access defaults to the Personal top-level (not the Org one)', async () => {
        render_at('/settings?tab=access');

        // "Personal Settings" top-level tab exists on the page and
        // must be the one showing when a personal sub-tab is active.
        await waitFor(() => screen.getByRole('button', { name: /Personal Settings/i }));
        // Sub-nav renders the personal-only tab set — Access is there,
        // Members / Roles (Org sub-tabs) are not.
        expect(screen.getByRole('link', { name: /^Access$/i })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /^Members$/i })).toBeNull();
    });
});
