import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const auth_fetch = vi.fn();

vi.mock('@/lib/org_context', () => ({
	useOrgFetch: () => auth_fetch,
	useOrg: () => ({ current_org: { id: 1, slug: 'acme' }, orgs: [], is_multi_org: false, is_personal: false, loading: false, switch_org: () => {} }),
}));

import { Component as NotificationsPage } from '@/pages/notifications_page';

describe('NotificationsPage', () => {
	beforeEach(() => {
		auth_fetch.mockReset();
		auth_fetch.mockResolvedValue({
			json: async () => ({ ok: true, data: { items: [], total: 0, offset: 0, limit: 50 } }),
		});
	});

	it('defaults to inbox and loads /v1/notifications/get', async () => {
		render(
			<MemoryRouter>
				<NotificationsPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(auth_fetch).toHaveBeenCalledWith(
				'/v1/notifications/get',
				expect.objectContaining({ method: 'POST' }),
			);
		});
		expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'HUG Reviews' })).toBeNull();
	});

	it('renders rows from /v1/notifications/get', async () => {
		auth_fetch.mockResolvedValue({
			json: async () => ({
				ok: true,
				data: {
					items: [{
						id: 'n1',
						event: 'run.failed',
						title: null,
						message: 'boom',
						realm_id: 'realm-abcdef01',
						team: '@acme/demo',
						run_id: 'run-12345678',
						phase: 'build',
						severity: 'error',
						created_at: Date.UTC(2026, 0, 15, 12, 0, 0),
					}],
					total: 1,
					offset: 0,
					limit: 50,
				},
			}),
		});

		render(
			<MemoryRouter initialEntries={['/notifications']}>
				<NotificationsPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('boom')).toBeInTheDocument();
		});
		expect(screen.getByText('run.failed')).toBeInTheDocument();
	});

	it('redirects ?tab=reviews to /hug', async () => {
		render(
			<MemoryRouter initialEntries={['/notifications?tab=reviews']}>
				<Routes>
					<Route path="/notifications" element={<NotificationsPage />} />
					<Route path="/hug" element={<div data-testid="hug-page">hug</div>} />
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('hug-page')).toBeInTheDocument();
		});
	});
});
