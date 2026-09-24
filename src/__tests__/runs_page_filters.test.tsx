import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { AuthProvider } from '@/lib/auth_context';
import { OrgProvider } from '@/lib/org_context';
import type { Realm_outlet_context } from '@/layouts/realm_layout';
import { Component as RunsPage } from '@/pages/runs/runs_page';

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
				daemons: [{ id: 'd1', name: 'mac-lab', status: 'online' }],
			}));
		}
		if (url.includes('/v1/runs/get')) {
			return new Response(JSON.stringify({
				ok: true,
				total: 2,
				runs: [
					{
						run_id: 'run_aaaaaaaaaaaa',
						run_name: 'Claim CLM-1042',
						state: 'running',
						team_label: '@acme/claims-intake',
						daemon_id: 'd1',
						workspace_name: 'ws',
						started_at: Date.now(),
					},
					{
						run_id: 'run_bbbbbbbbbbbb',
						run_name: null,
						state: 'completed',
						team_label: '@cliq/smoke',
						daemon_id: 'd1',
						started_at: Date.now(),
					},
				],
			}));
		}
		return new Response(JSON.stringify({ ok: false }), { status: 404 });
	});
});

function render_runs(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<AuthProvider>
				<OrgProvider>
					<Routes>
						<Route path="/o/:org/realms/:slug" element={<Realm_shell />}>
							<Route path="runs" element={<RunsPage />} />
						</Route>
					</Routes>
				</OrgProvider>
			</AuthProvider>
		</MemoryRouter>,
	);
}

describe('RunsPage filters', () => {
	it('leads with run name and shows filters', async () => {
		render_runs('/o/acme/realms/acme-prod/runs');
		await waitFor(() => expect(screen.getByText('Claim CLM-1042')).toBeInTheDocument());
		expect(screen.getByRole('columnheader', { name: 'Run name' })).toBeInTheDocument();
		expect(screen.getByLabelText('Filter by team')).toBeInTheDocument();
		expect(screen.getByLabelText('Filter by status')).toBeInTheDocument();
		expect(screen.getByLabelText('Filter by daemon')).toBeInTheDocument();
	});

	it('auto-filters from ?team= and shows View team', async () => {
		render_runs('/o/acme/realms/acme-prod/runs?team=acme/claims-intake');
		await waitFor(() => expect(screen.getByText('Claim CLM-1042')).toBeInTheDocument());
		expect(screen.queryByText('run_bbbb…')).not.toBeInTheDocument();
		expect(screen.getAllByText('View team').length).toBeGreaterThan(0);
		expect(screen.getByText(/team: @acme\/claims-intake/)).toBeInTheDocument();
	});

});
