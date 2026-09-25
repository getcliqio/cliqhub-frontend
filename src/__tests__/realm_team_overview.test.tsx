import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Realm_team_overview } from '@/components/realm_team_overview';

const auth_fetch = vi.fn();

vi.mock('@/lib/org_context', () => ({
	useOrgFetch: () => auth_fetch,
	useOrg: () => ({ current_org: { id: 1, slug: 'test', display_name: 'Test' }, orgs: [], loading: false, is_multi_org: false, is_personal: true, switch_org: () => {} }),
}));

function json_response(body: unknown) {
	return Promise.resolve({
		ok: true,
		json: async () => body,
	});
}

describe('Realm_team_overview', () => {
	beforeEach(() => {
		auth_fetch.mockReset();
		auth_fetch.mockImplementation(async (url: string) => {
			if (url.includes('/v1/teams/get_by_id')) {
				return json_response({
					ok: true,
					data: {
						description: 'Zero-config hello-world team.',
						latest_version: '1.2.0',
						inputs: [{ name: 'message', description: 'Greeting text' }],
						workflow: {
							phases: [
								{ name: 'greet', type: 'standard', agent: 'exec' },
								{ name: 'done', type: 'standard', agent: 'exec' },
							],
						},
						agents: {},
					},
				});
			}
			if (url === '/v1/teams/get' || url.endsWith('/v1/teams/get')) {
				return json_response({
					ok: true,
					rows: [{
						scope: 'cliq',
						slug: 'hello-world',
						label: '@cliq/hello-world',
						installed_daemon_ids: ['d1'],
						installed_count: 1,
						online_daemon_count: 1,
						coverage_label: '1/1 online',
						version: '1.2.0',
						sample_team_id: 't1',
						origin: 'published',
						in_team_list: true,
						last_run_at: Date.now() - 3600_000,
					}],
				});
			}
			if (url.includes('/v1/daemons/get')) {
				return json_response({
					ok: true,
					daemons: [{
						id: 'd1',
						name: 'builder',
						hostname: 'host-1',
						status: 'online',
					}],
				});
			}
			if (url.includes('/v1/runs/get')) {
				return json_response({
					ok: true,
					data: {
						items: [{
							run_id: 'run-1',
							run_name: 'smoke',
							state: 'completed',
							team_label: '@cliq/hello-world',
							started_at: Date.now() - 7200_000,
						}],
						total: 1,
					},
				});
			}
			return json_response({ ok: true });
		});
	});

	it('renders description, phases, inputs, install map, and recent runs', async () => {
		render(
			<MemoryRouter>
				<Realm_team_overview
					realm_id="r1"
					realm_slug="demo"
					realm_name="Demo"
					scope="cliq"
					slug="hello-world"
					base_path="/realms/demo"
				/>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('Zero-config hello-world team.')).toBeInTheDocument();
		});

		expect(screen.getByText('greet')).toBeInTheDocument();
		expect(screen.getByText('done')).toBeInTheDocument();
		expect(screen.getByText('message')).toBeInTheDocument();
		expect(screen.getByText('Greeting text')).toBeInTheDocument();
		expect(screen.getByText('builder')).toBeInTheDocument();
		expect(screen.getByText('installed · v1.2.0')).toBeInTheDocument();
		expect(screen.getByText('smoke')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /start run/i })).toBeInTheDocument();
		expect(screen.queryByText(/Filter team =/i)).not.toBeInTheDocument();
	});
});
