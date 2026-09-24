/**
 * Slice 1.7 — Settings → Integrations → JIRA.
 *
 * The page:
 *  - Redirects to /settings when VITE_ENABLE_JIRA_INTEGRATION is unset.
 *  - Otherwise POSTs `/v1/integrations/jira/list` (empty body → session
 *    cookie identifies caller) and renders one row per admin realm.
 *  - Bound rows show workspace_id + connected date + action buttons.
 *  - Unbound rows show a "Not connected" pill.
 *  - Rotate button POSTs /v1/integrations/jira/rotate_secret and reveals
 *    the returned secret via the shared NewTokenBanner.
 *  - Disconnect prompts, then POSTs /v1/integrations/jira/disconnect.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const auth_fetch = vi.fn();

vi.mock('@/lib/org_context', () => ({
	useOrgFetch: () => auth_fetch,
	useOrg: () => ({
		current_org: { id: 1, slug: 'acme' }, orgs: [], is_multi_org: false,
		is_personal: false, loading: false, switch_org: () => {},
	}),
}));

import { Component as JiraPage } from '@/pages/account/jira_integration_page';

const BOUND_ROW = {
	realm_id: 'realm-bound',
	realm_slug: 'engineering',
	realm_name: 'Engineering',
	channel_id: 'chan-1',
	workspace_id: 'ws-abc123',
	connected_at: Date.UTC(2026, 0, 15),
};

const UNBOUND_ROW = {
	realm_id: 'realm-unbound',
	realm_slug: 'marketing',
	realm_name: 'Marketing',
	channel_id: null,
	workspace_id: null,
	connected_at: null,
};

function stub_list(bindings: unknown[]) {
	auth_fetch.mockResolvedValueOnce({
		status: 200,
		json: async () => ({ ok: true, bindings }),
	});
}

describe('JIRA integration page', () => {
	beforeEach(() => {
		auth_fetch.mockReset();
		vi.stubEnv('VITE_ENABLE_JIRA_INTEGRATION', 'true');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('redirects to /settings when flag is not "true"', async () => {
		vi.stubEnv('VITE_ENABLE_JIRA_INTEGRATION', '');
		render(
			<MemoryRouter initialEntries={['/settings/integrations/jira']}>
				<Routes>
					<Route path="/settings/integrations/jira" element={<JiraPage />} />
					<Route path="/settings" element={<div data-testid="settings-page">settings</div>} />
				</Routes>
			</MemoryRouter>,
		);
		expect(await screen.findByTestId('settings-page')).toBeInTheDocument();
		expect(auth_fetch).not.toHaveBeenCalled();
	});

	it('lists bindings, renders bound + unbound rows differently', async () => {
		stub_list([BOUND_ROW, UNBOUND_ROW]);
		render(
			<MemoryRouter>
				<JiraPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(auth_fetch).toHaveBeenCalledWith(
				'/v1/integrations/jira/list',
				expect.objectContaining({ method: 'POST' }),
			);
		});

		expect(await screen.findByText('Engineering')).toBeInTheDocument();
		expect(screen.getByText('ws-abc123')).toBeInTheDocument();
		expect(screen.getByText('Marketing')).toBeInTheDocument();
		expect(screen.getByText('Not connected')).toBeInTheDocument();
	});

	it('rotate button reveals the new secret via NewTokenBanner', async () => {
		stub_list([BOUND_ROW]);
		auth_fetch.mockResolvedValueOnce({
			status: 200,
			json: async () => ({ ok: true, secret: 'whsec_new-secret-xyz' }),
		});

		render(<MemoryRouter><JiraPage /></MemoryRouter>);

		const rotate_btn = await screen.findByRole('button', { name: /rotate secret/i });
		fireEvent.click(rotate_btn);

		await waitFor(() => {
			expect(auth_fetch).toHaveBeenCalledWith(
				'/v1/integrations/jira/rotate_secret',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({ realm_id: 'realm-bound', workspace_id: 'ws-abc123' }),
				}),
			);
		});
		expect(await screen.findByText('whsec_new-secret-xyz')).toBeInTheDocument();
	});

	it('disconnect confirms + POSTs disconnect + refetches list', async () => {
		stub_list([BOUND_ROW]);
		auth_fetch.mockResolvedValueOnce({
			status: 200,
			json: async () => ({ ok: true, removed: true }),
		});
		auth_fetch.mockResolvedValueOnce({
			status: 200,
			json: async () => ({ ok: true, bindings: [{ ...BOUND_ROW, channel_id: null, workspace_id: null, connected_at: null }] }),
		});

		const confirm_spy = vi.spyOn(window, 'confirm').mockReturnValue(true);
		try {
			render(<MemoryRouter><JiraPage /></MemoryRouter>);
			const disc_btn = await screen.findByRole('button', { name: /disconnect/i });
			fireEvent.click(disc_btn);

			await waitFor(() => {
				expect(auth_fetch).toHaveBeenCalledWith(
					'/v1/integrations/jira/disconnect',
					expect.objectContaining({ method: 'POST' }),
				);
			});
			expect(confirm_spy).toHaveBeenCalled();
		} finally {
			confirm_spy.mockRestore();
		}
	});

	it('surfaces backend-flag-off (404) as a friendly banner', async () => {
		auth_fetch.mockResolvedValueOnce({
			status: 404,
			json: async () => ({ ok: false, error: 'Unknown API route' }),
		});
		render(<MemoryRouter><JiraPage /></MemoryRouter>);
		expect(await screen.findByText(/not enabled on this Cliq deployment/i)).toBeInTheDocument();
	});

	it('renders N rows for one realm bound to N workspaces (slice 1.8 multi-binding)', async () => {
		// The slice-1.8 backend emits one row per (realm × binding).
		// A single realm bound to two JIRA workspaces produces two
		// bound rows — the SPA must not collapse them under the same
		// React key. Both workspace_ids should be visible.
		stub_list([
			{ ...BOUND_ROW, channel_id: 'chan-a', workspace_id: 'ws-alpha' },
			{ ...BOUND_ROW, channel_id: 'chan-b', workspace_id: 'ws-beta' },
		]);
		render(<MemoryRouter><JiraPage /></MemoryRouter>);
		expect(await screen.findByText('ws-alpha')).toBeInTheDocument();
		expect(screen.getByText('ws-beta')).toBeInTheDocument();
	});
});
