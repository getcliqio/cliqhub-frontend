/**
 * Integration tests for the token freshness badges rendered next
 * to "Last used" on the tokens page (slice 5.4).
 *
 * Verifies that each freshness bucket produced by the classifier
 * ends up on the DOM with the right label — so the visible column
 * doesn't silently drift from the pure helper's logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const auth_fetch = vi.fn();

vi.mock('@/lib/org_context', () => ({
    useOrgFetch: () => auth_fetch,
    useOrg: () => ({
        current_org: { id: 1, slug: 'acme' }, orgs: [], is_multi_org: false,
        is_personal: false, loading: false, switch_org: () => {},
    }),
}));

import { Component as Tokens_page } from '@/pages/account/tokens_page';

const NOW_MS = Date.now();
function iso_ago(days: number): string {
    return new Date(NOW_MS - days * 86_400_000).toISOString();
}

function stub_tokens(tokens: Array<Record<string, unknown>>) {
    auth_fetch.mockResolvedValueOnce({
        json: async () => ({ ok: true, data: { tokens, total: tokens.length } }),
    });
    // orgs load (non-critical follow-up call)
    auth_fetch.mockResolvedValueOnce({
        json: async () => ({ ok: true, data: { orgs: [] } }),
    });
}

function render_page() {
    return render(
        <MemoryRouter initialEntries={['/tokens']}>
            <Tokens_page />
        </MemoryRouter>,
    );
}

describe('Tokens page — freshness badges', () => {
    beforeEach(() => auth_fetch.mockReset());

    it('renders one badge per token row', async () => {
        stub_tokens([
            { id: 't1', name: 'a', permissions: {}, created_at: iso_ago(60), last_used_at: iso_ago(1) },
            { id: 't2', name: 'b', permissions: {}, created_at: iso_ago(60), last_used_at: iso_ago(45) },
        ]);
        render_page();

        const badges = await waitFor(() => screen.getAllByTestId('token-freshness-badge'));
        expect(badges).toHaveLength(2);
    });

    it('classifies a recently-used token as "active"', async () => {
        stub_tokens([
            { id: 't1', name: 'a', permissions: {}, created_at: iso_ago(60), last_used_at: iso_ago(1) },
        ]);
        render_page();

        const badge = await waitFor(() => screen.getByTestId('token-freshness-badge'));
        expect(badge.getAttribute('data-freshness')).toBe('active');
        expect(badge.textContent).toMatch(/active/i);
    });

    it('classifies a 20-day-old-used token as "stale"', async () => {
        stub_tokens([
            { id: 't1', name: 'a', permissions: {}, created_at: iso_ago(60), last_used_at: iso_ago(20) },
        ]);
        render_page();

        const badge = await waitFor(() => screen.getByTestId('token-freshness-badge'));
        expect(badge.getAttribute('data-freshness')).toBe('stale');
    });

    it('classifies a 45-day-old-used token as "inactive"', async () => {
        stub_tokens([
            { id: 't1', name: 'a', permissions: {}, created_at: iso_ago(60), last_used_at: iso_ago(45) },
        ]);
        render_page();

        const badge = await waitFor(() => screen.getByTestId('token-freshness-badge'));
        expect(badge.getAttribute('data-freshness')).toBe('inactive');
    });

    it('classifies a never-used token minted 10 days ago as "unused"', async () => {
        stub_tokens([
            { id: 't1', name: 'ghost', permissions: {}, created_at: iso_ago(10), last_used_at: null },
        ]);
        render_page();

        const badge = await waitFor(() => screen.getByTestId('token-freshness-badge'));
        expect(badge.getAttribute('data-freshness')).toBe('unused');
    });

    it('classifies a just-minted never-used token as "active" (grace window)', async () => {
        stub_tokens([
            { id: 't1', name: 'fresh', permissions: {}, created_at: iso_ago(0), last_used_at: null },
        ]);
        render_page();

        const badge = await waitFor(() => screen.getByTestId('token-freshness-badge'));
        expect(badge.getAttribute('data-freshness')).toBe('active');
    });
});
