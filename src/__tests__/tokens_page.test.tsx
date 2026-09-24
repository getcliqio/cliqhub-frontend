/**
 * Tokens page create flow — grant via permissions.domains.orgs only.
 * Capability `scopes` are no longer accepted on mint.
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

import { Component as TokensPage } from '@/pages/account/tokens_page';

function stub_initial_loads(orgs: Array<{ id: string; slug: string; display_name: string }> = []) {
	auth_fetch.mockResolvedValueOnce({
		json: async () => ({ ok: true, data: { tokens: [], total: 0 } }),
	});
	auth_fetch.mockResolvedValueOnce({
		json: async () => ({ ok: true, data: { orgs } }),
	});
}

describe('tokens page create flow', () => {
	beforeEach(() => {
		auth_fetch.mockReset();
	});

	it('omits permissions when no orgs selected', async () => {
		stub_initial_loads();
		auth_fetch.mockResolvedValueOnce({
			json: async () => ({ ok: true, data: { token: 'cliq_tok_default' } }),
		});
		auth_fetch.mockResolvedValueOnce({
			json: async () => ({ ok: true, data: { tokens: [], total: 0 } }),
		});

		render(
			<MemoryRouter initialEntries={['/tokens?create=1']}>
				<TokensPage />
			</MemoryRouter>,
		);

		const name_input = await screen.findByLabelText(/token name/i);
		fireEvent.change(name_input, { target: { value: 'default-token' } });
		fireEvent.click(screen.getByRole('button', { name: /create token/i }));

		await waitFor(() => {
			const call = auth_fetch.mock.calls.find(
				(c) => c[0] === '/v1/auth/generate_token',
			);
			expect(call).toBeDefined();
			const body = JSON.parse(call![1].body);
			expect(body.name).toBe('default-token');
			expect(body.type).toBe('user');
			expect(body.scopes).toBeUndefined();
			expect(body.permissions).toBeUndefined();
		});
	});

	it('sends permissions.domains.orgs when orgs selected', async () => {
		stub_initial_loads([
			{ id: '42', slug: 'acme', display_name: 'Acme' },
			{ id: '7', slug: 'beta', display_name: 'Beta' },
		]);
		auth_fetch.mockResolvedValueOnce({
			json: async () => ({ ok: true, data: { token: 'cliq_tok_org' } }),
		});
		auth_fetch.mockResolvedValueOnce({
			json: async () => ({ ok: true, data: { tokens: [], total: 0 } }),
		});

		render(
			<MemoryRouter initialEntries={['/tokens?create=1']}>
				<TokensPage />
			</MemoryRouter>,
		);

		const name_input = await screen.findByLabelText(/token name/i);
		fireEvent.change(name_input, { target: { value: 'ci-token' } });
		fireEvent.click(await screen.findByRole('button', { name: 'Acme' }));
		fireEvent.click(screen.getByRole('button', { name: /create token/i }));

		await waitFor(() => {
			const call = auth_fetch.mock.calls.find(
				(c) => c[0] === '/v1/auth/generate_token',
			);
			expect(call).toBeDefined();
			const body = JSON.parse(call![1].body);
			expect(body.name).toBe('ci-token');
			expect(body.scopes).toBeUndefined();
			expect(body.permissions).toEqual({ domains: { orgs: ['42'] } });
		});
	});

	it('does not render capability scope checkboxes', async () => {
		stub_initial_loads();
		render(
			<MemoryRouter initialEntries={['/tokens?create=1']}>
				<TokensPage />
			</MemoryRouter>,
		);
		await screen.findByLabelText(/token name/i);
		expect(screen.queryByLabelText(/scope dispatch/i)).toBeNull();
		expect(screen.queryByText(/Capability scopes/i)).toBeNull();
	});
});
