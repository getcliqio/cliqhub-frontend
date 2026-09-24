/**
 * Integration tests for the tokens page sort dropdown (slice 5.5).
 *
 * Verifies:
 *   • the dropdown is discoverable
 *   • picking an option re-orders the visible rows (client-side)
 *   • the URL is updated so bookmarks survive refresh
 *   • "least recently used" surfaces never-used tokens first
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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

function iso_days_ago(days: number): string {
    return new Date(Date.now() - days * 86_400_000).toISOString();
}

function stub_tokens(tokens: Array<Record<string, unknown>>) {
    // First call: get_tokens
    auth_fetch.mockResolvedValueOnce({
        json: async () => ({ ok: true, data: { tokens, total: tokens.length } }),
    });
    // Second call: orgs load (non-critical, may be called again on re-render)
    auth_fetch.mockResolvedValue({
        json: async () => ({ ok: true, data: { orgs: [] } }),
    });
}

function row_names(): string[] {
    const rows = screen.getAllByTestId('token-freshness-badge');
    // Walk up to the <tr> and read the `data-token-name` we render.
    return rows.map((badge) => {
        let node: HTMLElement | null = badge;
        while (node && !node.getAttribute('data-token-name')) {
            node = node.parentElement;
        }
        return node?.getAttribute('data-token-name') ?? '';
    });
}

function render_page(initial_url: string = '/tokens') {
    return render(
        <MemoryRouter initialEntries={[initial_url]}>
            <Tokens_page />
        </MemoryRouter>,
    );
}

describe('Tokens page — slice 5.5 sort dropdown', () => {
    beforeEach(() => auth_fetch.mockReset());

    it('renders a sort dropdown with the three declared options', async () => {
        stub_tokens([
            { id: 't1', name: 'alpha', permissions: {}, created_at: iso_days_ago(5), last_used_at: null },
        ]);
        render_page();

        const select = await waitFor(() =>
            screen.getByTestId('tokens-sort-select') as HTMLSelectElement,
        );
        const opt_texts = within(select).getAllByRole('option').map((o) => o.textContent);
        expect(opt_texts).toEqual(['Newest', 'Oldest', 'Least recently used']);
    });

    it('defaults to Newest (created_at DESC) when no ?sort= is set', async () => {
        stub_tokens([
            { id: 'old',    name: 'old',    permissions: {}, created_at: iso_days_ago(30), last_used_at: null },
            { id: 'recent', name: 'recent', permissions: {}, created_at: iso_days_ago(1),  last_used_at: null },
            { id: 'mid',    name: 'mid',    permissions: {}, created_at: iso_days_ago(10), last_used_at: null },
        ]);
        render_page();

        await waitFor(() => screen.getAllByTestId('token-freshness-badge'));
        expect(row_names()).toEqual(['recent', 'mid', 'old']);
    });

    it('deep-links ?sort=oldest to reversed created_at order', async () => {
        stub_tokens([
            { id: 'old',    name: 'old',    permissions: {}, created_at: iso_days_ago(30), last_used_at: null },
            { id: 'recent', name: 'recent', permissions: {}, created_at: iso_days_ago(1),  last_used_at: null },
            { id: 'mid',    name: 'mid',    permissions: {}, created_at: iso_days_ago(10), last_used_at: null },
        ]);
        render_page('/tokens?sort=oldest');

        await waitFor(() => screen.getAllByTestId('token-freshness-badge'));
        expect(row_names()).toEqual(['old', 'mid', 'recent']);
    });

    it('deep-links ?sort=least_recently_used surfaces never-used tokens first', async () => {
        stub_tokens([
            { id: 'active', name: 'active', permissions: {}, created_at: iso_days_ago(30), last_used_at: iso_days_ago(1) },
            { id: 'ghost',  name: 'ghost',  permissions: {}, created_at: iso_days_ago(30), last_used_at: null },
            { id: 'faded',  name: 'faded',  permissions: {}, created_at: iso_days_ago(30), last_used_at: iso_days_ago(20) },
        ]);
        render_page('/tokens?sort=least_recently_used');

        await waitFor(() => screen.getAllByTestId('token-freshness-badge'));
        // ghost (never-used) first, then faded (older last_used), then active
        expect(row_names()).toEqual(['ghost', 'faded', 'active']);
    });

    it('changing the dropdown re-orders the rows client-side (no reload)', async () => {
        stub_tokens([
            { id: 'old',    name: 'old',    permissions: {}, created_at: iso_days_ago(30), last_used_at: null },
            { id: 'recent', name: 'recent', permissions: {}, created_at: iso_days_ago(1),  last_used_at: null },
        ]);
        render_page();

        await waitFor(() => screen.getAllByTestId('token-freshness-badge'));
        expect(row_names()).toEqual(['recent', 'old']);

        const before_calls = auth_fetch.mock.calls.length;
        const select = screen.getByTestId('tokens-sort-select') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'oldest' } });

        await waitFor(() => expect(row_names()).toEqual(['old', 'recent']));
        // No refetch triggered — sort happens purely client-side.
        expect(auth_fetch.mock.calls.length).toBe(before_calls);
    });
});
