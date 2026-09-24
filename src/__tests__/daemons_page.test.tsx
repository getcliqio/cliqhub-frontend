import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { AuthProvider } from '@/lib/auth_context';
import { OrgProvider } from '@/lib/org_context';
import type { Realm_outlet_context } from '@/layouts/realm_layout';
import { Component as DaemonsPage } from '@/pages/account/daemons_page';

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

const DAEMONS = [
	{
		id: 'daemon-online-1',
		name: 'builder-1',
		hostname: 'builder-1.local',
		status: 'online',
		last_heartbeat: Date.now() - 5_000,
		workspace_count: 2,
		active_run_count: 1,
		capacity: 2,
		user_id: '1',
		user_email: 's@test.com',
		ip: null,
		port: null,
		public_url: null,
		created_at: Date.now(),
		last_registered_at: Date.now(),
	},
	{
		id: 'daemon-stale-2',
		name: null,
		hostname: 'stale-host',
		status: 'stale',
		last_heartbeat: Date.now() - 600_000,
		workspace_count: 0,
		active_run_count: 0,
		capacity: 1,
		user_id: '1',
		user_email: 's@test.com',
		ip: null,
		port: null,
		public_url: null,
		created_at: Date.now(),
		last_registered_at: Date.now(),
	},
];

function Realm_shell() {
	return <Outlet context={REALM_CTX} />;
}

beforeEach(() => {
	vi.restoreAllMocks();
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/v1/session/get')) {
			return new Response(JSON.stringify(MOCK_ME));
		}
		if (url.includes('/v1/orgs/get')) {
			return new Response(JSON.stringify({ ok: true, orgs: [{ id: 1, slug: 'sapan', display_name: 'Personal' }] }));
		}
		if (url.includes('/v1/daemons/get')) {
			return new Response(JSON.stringify({
				ok: true,
				daemons: DAEMONS,
				total: DAEMONS.length,
			}));
		}
		return new Response(JSON.stringify({ ok: false }), { status: 404 });
	});
});

function render_page() {
	return render(
		<MemoryRouter initialEntries={['/o/acme/realms/acme-prod/daemons']}>
			<AuthProvider>
				<OrgProvider>
					<Routes>
						<Route path="/o/:org/realms/:slug" element={<Realm_shell />}>
							<Route path="daemons" element={<DaemonsPage />} />
							<Route path="daemons/:daemon_id" element={<div>Daemon detail</div>} />
						</Route>
					</Routes>
				</OrgProvider>
			</AuthProvider>
		</MemoryRouter>,
	);
}

describe('Realm DaemonsPage', () => {
	it('renders a table of daemons instead of cards', async () => {
		render_page();
		await waitFor(() => expect(screen.getByText('builder-1')).toBeInTheDocument());

		expect(screen.getByRole('columnheader', { name: 'Daemon' })).toBeInTheDocument();
		expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
		expect(screen.getByRole('columnheader', { name: 'Heartbeat' })).toBeInTheDocument();
		expect(screen.getByText('online')).toBeInTheDocument();
		expect(screen.getByText('stale')).toBeInTheDocument();
		expect(screen.getByText('stale-host')).toBeInTheDocument();
	});

	it('navigates to daemon detail when a row is clicked', async () => {
		render_page();
		await waitFor(() => expect(screen.getByText('builder-1')).toBeInTheDocument());

		fireEvent.click(screen.getByRole('link', { name: /Open daemon builder-1/i }));
		await waitFor(() => expect(screen.getByText('Daemon detail')).toBeInTheDocument());
	});
});
