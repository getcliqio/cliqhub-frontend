/**
 * Tests for review_detail_page.tsx in different modes.
 *
 * Validates chat panel visibility, verdict buttons presence,
 * and mode-specific rendering logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

const auth_fetch = vi.fn();

vi.mock('@/lib/org_context', () => ({
    useOrgFetch: () => auth_fetch,
    useOrg: () => ({ current_org: { id: 1, slug: 'acme' }, orgs: [], is_multi_org: false, is_personal: false, loading: false, switch_org: () => {} }),
}));

vi.mock('@/lib/auth_context', () => ({
    useAuth: () => ({
        user: { id: 1, username: 'elan', email: 'elan@test.com' },
    }),
}));

const navigate = vi.fn();
vi.mock('react-router', async () => {
    const actual = await vi.importActual<typeof import('react-router')>('react-router');
    return {
        ...actual,
        useNavigate: () => navigate,
    };
});

import { Component as ReviewDetailPage } from '@/pages/review_detail_page';

/** Build a mock review DTO. */
function make_review(overrides: Record<string, unknown> = {}) {
    return {
        id: 'rev-123',
        run_id: 'run-abc',
        run_name: 'test-run',
        realm_id: 'realm-1',
        realm_name: 'default',
        realm_slug: 'default',
        org_slug: 'acme',
        team: '@acme/test',
        phase: 'implement',
        payload: {},
        verdict: null,
        status: 'pending',
        route_targets: null,
        created_at: new Date().toISOString(),
        timeout_at: new Date(Date.now() + 3_600_000).toISOString(),
        completed_at: null,
        artifacts: [],
        claimed_by: null,
        claimed_at: null,
        message_count: 0,
        /** Default group so verdict buttons render for the mocked auth user. */
        notification_groups: [{
            group_idx: 0,
            policy: 'any',
            channels: ['hub'],
            satisfied: false,
            notifications: [{
                id: 'notif-1',
                group_idx: 0,
                channel_target: 'elan',
                channel_id: null,
                user_id: 1,
                responded_by: null,
                responded_at: null,
                action: null,
                comment: null,
            }],
        }],
        ...overrides,
    };
}

/** Render the page within a routing context at /reviews/rev-123. */
function render_page() {
    return render(
        <MemoryRouter initialEntries={['/reviews/rev-123']}>
            <Routes>
                <Route path="/reviews/:review_id" element={<ReviewDetailPage />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('ReviewDetailPage — mode detection', () => {
    beforeEach(() => {
        auth_fetch.mockReset();
        navigate.mockReset();
    });

    it('chat mode renders chat panel + verdict buttons', async () => {
        auth_fetch.mockImplementation((url: string) => {
            if (url === '/v1/reviews/get_by_id') {
                return Promise.resolve({
                    json: async () => ({
                        ok: true,
                        data: make_review({
                            payload: { mode: 'chat', message: 'I need help deciding' },
                        }),
                    }),
                });
            }
            /** Messages endpoint for the chat panel. */
            if (url === '/v1/reviews/get_messages') {
                return Promise.resolve({
                    json: async () => ({ ok: true, data: [] }),
                });
            }
            return Promise.resolve({ json: async () => ({ ok: true }) });
        });

        render_page();

        await waitFor(() => {
            /** Chat panel should be visible. */
            expect(screen.getByText('Agent Chat')).toBeTruthy();
            /** Verdict buttons should still be present. */
            expect(screen.getByText('Approve')).toBeTruthy();
        });
    });

    it('chat mode shows appropriate title', async () => {
        auth_fetch.mockImplementation((url: string) => {
            if (url === '/v1/reviews/get_by_id') {
                return Promise.resolve({
                    json: async () => ({
                        ok: true,
                        data: make_review({
                            payload: { mode: 'chat' },
                        }),
                    }),
                });
            }
            if (url === '/v1/reviews/get_messages') {
                return Promise.resolve({
                    json: async () => ({ ok: true, data: [] }),
                });
            }
            return Promise.resolve({ json: async () => ({ ok: true }) });
        });

        render_page();

        await waitFor(() => {
            expect(screen.getByText('Chat: implement')).toBeTruthy();
            expect(screen.getByText('Chat with the agent, then approve or reject when ready.')).toBeTruthy();
        });
    });

    it('verdict mode does not render chat panel', async () => {
        auth_fetch.mockResolvedValue({
            json: async () => ({
                ok: true,
                data: make_review({ payload: {} }),
            }),
        });

        render_page();

        await waitFor(() => {
            expect(screen.getByText('Review: implement')).toBeTruthy();
        });

        expect(screen.queryByText('Agent Chat')).toBeNull();
    });

    it('structured input mode does not render chat panel', async () => {
        auth_fetch.mockResolvedValue({
            json: async () => ({
                ok: true,
                data: make_review({
                    payload: {
                        mode: 'input_pause',
                        inputs_schema: [
                            { name: 'approach', type: 'text', required: true },
                        ],
                    },
                }),
            }),
        });

        render_page();

        await waitFor(() => {
            expect(screen.getByText('Inputs: implement')).toBeTruthy();
        });

        expect(screen.queryByText('Agent Chat')).toBeNull();
    });

    it('verdict buttons always visible during chat mode', async () => {
        auth_fetch.mockImplementation((url: string) => {
            if (url === '/v1/reviews/get_by_id') {
                return Promise.resolve({
                    json: async () => ({
                        ok: true,
                        data: make_review({
                            payload: { mode: 'chat' },
                            route_targets: ['rework'],
                        }),
                    }),
                });
            }
            if (url === '/v1/reviews/get_messages') {
                return Promise.resolve({
                    json: async () => ({ ok: true, data: [] }),
                });
            }
            return Promise.resolve({ json: async () => ({ ok: true }) });
        });

        render_page();

        await waitFor(() => {
            expect(screen.getByText('Approve')).toBeTruthy();
            expect(screen.getByText('Reject')).toBeTruthy();
            expect(screen.getByText('Route')).toBeTruthy();
        });
    });
});
