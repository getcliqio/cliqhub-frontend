/**
 * Slice 5.6 — tokens page wires the safety modal correctly.
 *
 * Focuses on the wiring: after a mint, the banner shows the "I have
 * saved this token" checkbox, the Done button is disabled, and
 * confirming clears the reveal from the DOM. The banner's internal
 * behaviour is tested separately (new_token_banner_safety.test).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

function stub_initial_loads() {
    auth_fetch.mockResolvedValueOnce({
        json: async () => ({ ok: true, data: { tokens: [], total: 0 } }),
    });
    auth_fetch.mockResolvedValueOnce({
        json: async () => ({ ok: true, data: { orgs: [] } }),
    });
}

async function mint_a_token(name = 'test-token') {
    const name_input = await screen.findByLabelText(/token name/i);
    fireEvent.change(name_input, { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: /create token/i }));
}

describe('Tokens page — post-mint safety modal (slice 5.6)', () => {
    beforeEach(() => auth_fetch.mockReset());

    it('shows the safety-modal after a mint (checkbox + Done disabled)', async () => {
        stub_initial_loads();
        auth_fetch.mockResolvedValueOnce({
            json: async () => ({ ok: true, data: { token: 'cliq_tok_secret123' } }),
        });
        // Reload after mint (list refresh).
        auth_fetch.mockResolvedValueOnce({
            json: async () => ({ ok: true, data: { tokens: [], total: 0 } }),
        });

        render(
            <MemoryRouter initialEntries={['/tokens?create=1']}>
                <Tokens_page />
            </MemoryRouter>,
        );

        await mint_a_token();

        const done = await waitFor(
            () => screen.getByTestId('new-token-done-button') as HTMLButtonElement,
        );
        expect(done.disabled).toBe(true);
        expect(screen.getByTestId('new-token-saved-checkbox')).toBeInTheDocument();
    });

    it('confirming dismisses the banner from the DOM', async () => {
        stub_initial_loads();
        auth_fetch.mockResolvedValueOnce({
            json: async () => ({ ok: true, data: { token: 'cliq_tok_secret456' } }),
        });
        auth_fetch.mockResolvedValueOnce({
            json: async () => ({ ok: true, data: { tokens: [], total: 0 } }),
        });

        render(
            <MemoryRouter initialEntries={['/tokens?create=1']}>
                <Tokens_page />
            </MemoryRouter>,
        );

        await mint_a_token();
        await waitFor(() => screen.getByText('cliq_tok_secret456'));

        fireEvent.click(screen.getByTestId('new-token-saved-checkbox'));
        fireEvent.click(screen.getByTestId('new-token-done-button'));

        await waitFor(() => {
            expect(screen.queryByText('cliq_tok_secret456')).toBeNull();
            expect(screen.queryByTestId('new-token-done-button')).toBeNull();
        });
    });

    it('renders the permissions summary (legacy full-power PAT case)', async () => {
        stub_initial_loads();
        auth_fetch.mockResolvedValueOnce({
            json: async () => ({ ok: true, data: { token: 'cliq_tok_legacy' } }),
        });
        auth_fetch.mockResolvedValueOnce({
            json: async () => ({ ok: true, data: { tokens: [], total: 0 } }),
        });

        render(
            <MemoryRouter initialEntries={['/tokens?create=1']}>
                <Tokens_page />
            </MemoryRouter>,
        );

        await mint_a_token();

        const summary = await waitFor(() => screen.getByTestId('new-token-permissions-summary'));
        // No orgs selected → default grant across every org the user belongs to.
        expect(summary.textContent).toMatch(/Act across every org you belong to \(default grant\)\./i);
    });
});
