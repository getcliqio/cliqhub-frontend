import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { AuthProvider } from '@/lib/auth_context';
import { OrgProvider } from '@/lib/org_context';
import type { Realm_outlet_context } from '@/layouts/realm_layout';
import { Component as RealmTeamsPage } from '@/pages/account/realm_teams_page';

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
		if (url.includes('/v1/teams/get') && !url.includes('/v1/teams/get_by_id') && !url.includes('/v1/teams/get_versions')) {
			return new Response(JSON.stringify({
				ok: true,
				total: 2,
				online_daemon_count: 2,
				offset: 0,
				limit: 50,
				rows: [
					{
						scope: 'acme', slug: 'claims-intake',
						label: '@acme/claims-intake',
						installed_daemon_ids: ['d1', 'd2'],
						installed_count: 2,
						online_daemon_count: 2,
						coverage_label: '2/2 online',
						version: '1.4.2',
						sample_team_id: 't1',
						origin: 'published',
						in_team_list: true,
					},
					{
						scope: 'cliq', slug: 'smoke',
						label: '@cliq/smoke',
						installed_daemon_ids: ['d1'],
						installed_count: 1,
						online_daemon_count: 2,
						coverage_label: '1/2 partial',
						version: '0.9.0',
						sample_team_id: 't3',
						origin: 'published',
						in_team_list: true,
					},
				],
			}));
		}
		if (url.includes('/v1/realms/add_team')) {
			return new Response(JSON.stringify({
				ok: true,
				install: {
					scope: 'acme',
					slug: 'claims-intake',
					daemon_results: [{ daemon_id: 'd1', ok: true }],
				},
			}));
		}
		return new Response(JSON.stringify({ ok: false }), { status: 404 });
	});
});

function render_page() {
	return render(
		<MemoryRouter initialEntries={['/o/acme/realms/acme-prod/teams']}>
			<AuthProvider>
				<OrgProvider>
					<Routes>
						<Route path="/o/:org/realms/:slug" element={<Realm_shell />}>
							<Route path="teams" element={<RealmTeamsPage />} />
						</Route>
					</Routes>
				</OrgProvider>
			</AuthProvider>
		</MemoryRouter>,
	);
}

describe('RealmTeamsPage', () => {
	it('lists teams and links the team name to realm team settings', async () => {
		render_page();
		await waitFor(() => expect(screen.getByText('@acme/claims-intake')).toBeInTheDocument());
		expect(screen.getByText('@cliq/smoke')).toBeInTheDocument();
		expect(screen.getByText('2/2 online')).toBeInTheDocument();

		const team_link = screen.getByRole('link', { name: '@acme/claims-intake' });
		expect(team_link.getAttribute('href')).toBe('/o/acme/realms/acme-prod/teams/acme/claims-intake');
	});

	it('opens the Run dialog with the team label and a Start run button', async () => {
		render_page();
		await waitFor(() => expect(screen.getByText('@acme/claims-intake')).toBeInTheDocument());
		fireEvent.click(screen.getAllByRole('button', { name: /^Run$/ })[0]);
		expect(screen.getByText('Run on realm')).toBeInTheDocument();
		expect(screen.getByPlaceholderText('Leave blank to auto-generate')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Start run/ })).toBeInTheDocument();
	});

	it('shows Force sync per realm team and posts realms/add_team', async () => {
		const confirm_spy = vi.spyOn(window, 'confirm').mockReturnValue(true);
		render_page();
		await waitFor(() => expect(screen.getByText('@acme/claims-intake')).toBeInTheDocument());

		const sync_buttons = screen.getAllByRole('button', { name: /Force sync/i });
		expect(sync_buttons.length).toBe(2);

		fireEvent.click(sync_buttons[0]);
		await waitFor(() => {
			const sync_calls = vi.mocked(globalThis.fetch).mock.calls.filter(
				([input]) => String(input).includes('/v1/realms/add_team'),
			);
			expect(sync_calls.length).toBe(1);
			const init = sync_calls[0][1] as RequestInit;
			expect(JSON.parse(String(init.body))).toEqual({
				realm_id: 'rlm_1',
				scope: 'acme',
				slug: 'claims-intake',
			});
		});
		confirm_spy.mockRestore();
	});
});
