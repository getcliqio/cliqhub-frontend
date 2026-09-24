import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { RealmLayout } from '@/layouts/realm_layout';
import { AuthProvider } from '@/lib/auth_context';
import { OrgProvider } from '@/lib/org_context';

const MOCK_ME = {
	ok: true,
	data: {
		user: { id: 1, username: 'sapan', display_name: 'Sapan', email: 's@test.com', role: 'user' },
		scopes: [],
	},
};

const MOCK_REALM = {
	ok: true,
	realm: { id: 'rlm_test', slug: 'acme-prod', name: 'Acme Production' },
};

beforeEach(() => {
	vi.restoreAllMocks();
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/v1/session/get') || url.includes('/session/get')) {
			return new Response(JSON.stringify(MOCK_ME));
		}
		if (url.includes('/v1/orgs/get')) {
			return new Response(JSON.stringify({ ok: true, orgs: [{ id: 1, slug: 'sapan', display_name: 'Personal' }] }));
		}
		if (url.includes('/v1/realms/get_by_id')) {
			return new Response(JSON.stringify(MOCK_REALM));
		}
		return new Response(JSON.stringify({ ok: false }), { status: 404 });
	});
});

function render_realm(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<AuthProvider>
				<OrgProvider>
					<Routes>
						<Route path="/o/:org/realms/:slug" element={<RealmLayout />}>
							<Route index element={<p>overview-index</p>} />
							<Route path="teams" element={<p>teams-page</p>} />
							<Route path="runs" element={<p>runs-page</p>} />
							<Route path="daemons" element={<p>daemons-page</p>} />
							<Route path="notifications" element={<p>notifications-page</p>} />
							<Route path="settings" element={<p>settings-page</p>} />
						</Route>
					</Routes>
				</OrgProvider>
			</AuthProvider>
		</MemoryRouter>,
	);
}

describe('RealmLayout primary nav', () => {
	it('renders Runs, Teams, Daemons, Agents, Notifications, Settings tabs', async () => {
		render_realm('/o/acme/realms/acme-prod/teams');
		await waitFor(() => expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument());
		expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Realms');
		expect(screen.getAllByText('Acme Production').length).toBeGreaterThan(0);
		const nav = screen.getByRole('navigation', { name: 'Realm sections' });
		expect(nav).toHaveTextContent('Teams');
		expect(nav).toHaveTextContent('Runs');
		expect(nav).toHaveTextContent('Daemons');
		expect(nav).toHaveTextContent('Agents');
		expect(nav).toHaveTextContent('Notifications');
		expect(nav).toHaveTextContent('Settings');
		expect(nav).not.toHaveTextContent('Security');
		expect(nav).not.toHaveTextContent('Overview');
		expect(nav).not.toHaveTextContent('Logs');
	});

	it('links Daemons to daemons path', async () => {
		render_realm('/o/acme/realms/acme-prod/teams');
		await waitFor(() => expect(screen.getByTitle('Daemons')).toBeInTheDocument());
		const daemons = screen.getByRole('link', { name: 'Daemons' });
		expect(daemons.getAttribute('href')).toBe('/o/acme/realms/acme-prod/daemons');
	});
});
