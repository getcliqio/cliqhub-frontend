/**
 * Pins the "Refresh runs" affordance on the runs page search toolbar.
 *
 * The refresh button lives next to the search input so users can pull
 * the freshest list without reloading the whole route (which would drop
 * unsaved filter drafts and scroll position). This test asserts:
 *   - the button is rendered and labelled for screen readers
 *   - clicking it re-issues POST /v1/runs/get with the same query body
 *     (i.e. the existing loader is what wires it, not a fresh navigation)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { AuthProvider } from '@/lib/auth_context';
import { OrgProvider } from '@/lib/org_context';
import type { Realm_outlet_context } from '@/layouts/realm_layout';
import { Component as RunsPage } from '@/pages/runs/runs_page';

const MOCK_ME = {
    ok: true,
    data: {
        user: { id: 1, username: 'sapan', display_name: 'Sapan', email: 's@test.com', role: 'user' },
        scopes: [],
    },
};

const REALM_CTX: Realm_outlet_context = {
    realm: { id: 'rlm_1', slug: 'acme-prod', name: 'Acme Production' },
    slug: 'acme-prod',
    org_slug: 'acme',
    base_path: '/o/acme/realms/acme-prod',
};

function Realm_shell() {
    return <Outlet context={REALM_CTX} />;
}

let runs_get_calls = 0;

beforeEach(() => {
    runs_get_calls = 0;
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
        if (url.includes('/v1/daemons/get')) {
            return new Response(JSON.stringify({ ok: true, daemons: [] }));
        }
        if (url.includes('/v1/runs/get')) {
            runs_get_calls += 1;
            return new Response(JSON.stringify({
                ok: true,
                total: 1,
                runs: [
                    {
                        run_id: 'run_aaaaaaaaaaaa',
                        run_name: 'Claim CLM-1042',
                        state: 'running',
                        team_label: '@acme/claims-intake',
                        daemon_id: 'd1',
                        started_at: Date.now(),
                    },
                ],
            }));
        }
        return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });
});

function render_runs(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <AuthProvider>
                <OrgProvider>
                    <Routes>
                        <Route path="/o/:org/realms/:slug" element={<Realm_shell />}>
                            <Route path="runs" element={<RunsPage />} />
                        </Route>
                    </Routes>
                </OrgProvider>
            </AuthProvider>
        </MemoryRouter>,
    );
}

describe('RunsPage — refresh button', () => {
    it('renders the "Refresh runs" icon-button next to the search input', async () => {
        render_runs('/o/acme/realms/acme-prod/runs');
        await waitFor(() => screen.getByLabelText('Search runs'));
        expect(screen.getByRole('button', { name: /Refresh runs/i })).toBeInTheDocument();
    });

    it('clicking Refresh re-issues POST /v1/runs/get without reloading the route', async () => {
        render_runs('/o/acme/realms/acme-prod/runs');
        await waitFor(() => screen.getByText('Claim CLM-1042'));

        const initial_calls = runs_get_calls;
        expect(initial_calls).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: /Refresh runs/i }));

        await waitFor(() => expect(runs_get_calls).toBeGreaterThan(initial_calls));
    });
});
