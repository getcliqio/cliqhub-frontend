/**
 * Pins the "Refresh teams" affordance on the My Teams search bar.
 *
 * Symmetric with runs_page_refresh.test.tsx — the icon-button next to
 * the search input re-fetches the teams list without a route navigation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '@/lib/auth_context';
import { OrgProvider } from '@/lib/org_context';
import { Component as TeamsPage } from '@/pages/account/teams_page';

const MOCK_ME = {
    ok: true,
    data: {
        user: { id: 1, username: 'sapan', display_name: 'Sapan', email: 's@test.com', role: 'user' },
        scopes: [],
    },
};

let teams_get_calls = 0;

beforeEach(() => {
    teams_get_calls = 0;
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/v1/session/get')) {
            return new Response(JSON.stringify(MOCK_ME));
        }
        if (url.includes('/v1/orgs/get')) {
            return new Response(JSON.stringify({
                ok: true,
                orgs: [{ id: 1, slug: 'sapan', display_name: 'Personal' }],
            }));
        }
        if (url.includes('/v1/teams/get')) {
            teams_get_calls += 1;
            return new Response(JSON.stringify({
                ok: true,
                data: {
                    scopes: [
                        {
                            slug: 'acme',
                            display_name: 'Acme',
                            scope_type: 'org',
                            visibility: 'public',
                            teams: [
                                {
                                    name: 'claims-intake',
                                    scope: 'acme',
                                    description: 'triage',
                                    latest_version: '1.0.0',
                                    install_count: 3,
                                    tags: [],
                                    listed: true,
                                },
                            ],
                        },
                    ],
                },
            }));
        }
        if (url.includes('/v1/teams/get')) {
            return new Response(JSON.stringify({ ok: true, data: { drafts: [] } }));
        }
        return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });
});

function render_teams() {
    return render(
        <MemoryRouter initialEntries={['/teams']}>
            <AuthProvider>
                <OrgProvider>
                    <Routes>
                        <Route path="/teams" element={<TeamsPage />} />
                    </Routes>
                </OrgProvider>
            </AuthProvider>
        </MemoryRouter>,
    );
}

describe('TeamsPage — refresh button', () => {
    it('renders the "Refresh teams" icon-button next to the search input', async () => {
        render_teams();
        await waitFor(() => screen.getByLabelText('Search teams'));
        expect(screen.getByRole('button', { name: /Refresh teams/i })).toBeInTheDocument();
    });

    it('clicking Refresh re-issues POST /v1/teams/get without leaving the route', async () => {
        render_teams();
        await waitFor(() => screen.getByText(/claims-intake/i));

        const initial_calls = teams_get_calls;
        expect(initial_calls).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: /Refresh teams/i }));

        await waitFor(() => expect(teams_get_calls).toBeGreaterThan(initial_calls));
    });
});
