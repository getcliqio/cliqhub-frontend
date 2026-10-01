/** Admin mode shell: guard, grouped nav, way back. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const auth = {
	user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'admin' as 'admin' | 'user', preferences: {} },
	loading: false,
	logout: vi.fn(),
	acting_as: null,
	stop_act_as: vi.fn(),
};
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => (u: string, i?: RequestInit) => fetch(u, i) }));

import { GraphiteAdminLayout, ADMIN_GROUPS } from '@/layouts/graphite_admin_layout';

function Where() {
	const loc = useLocation();
	return <div data-testid="where">{loc.pathname}</div>;
}

function render_at(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/admin" element={<GraphiteAdminLayout />}>
					<Route path="accounts" element={<p>accounts page</p>} />
					<Route path="orgs" element={<p>orgs page</p>} />
				</Route>
				<Route path="*" element={<Where />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('Admin mode', () => {
	afterEach(() => { auth.user.role = 'admin'; });

	it('shows the ADMIN mark, grouped nav, breadcrumb and the page', () => {
		render_at('/admin/accounts');
		expect(screen.getByText('ADMIN')).toBeInTheDocument();
		const nav = screen.getByRole('complementary', { name: 'Admin' });
		for (const g of ADMIN_GROUPS) {
			expect(within(nav).getByText(g.label)).toBeInTheDocument();
			for (const it of g.items) expect(within(nav).getByRole('link', { name: it.label })).toHaveAttribute('href', it.to);
		}
		expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Accounts')).toHaveAttribute('aria-current', 'page');
		expect(screen.getByText('accounts page')).toBeInTheDocument();
	});

	it('"Back to my work" falls back to the overview when nothing was remembered', () => {
		render_at('/admin/orgs');
		expect(screen.getByTestId('admin-back')).toHaveAttribute('href', '/home');
	});

	it('sends non-admins home', async () => {
		auth.user.role = 'user';
		render_at('/admin/accounts');
		expect(await screen.findByTestId('where')).toHaveTextContent('/home');
	});
});
