import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AuthProvider } from '@/lib/auth_context';
import { OrgProvider } from '@/lib/org_context';
import { Run_logs_section } from '@/components/runs/run_logs_section';

const MOCK_ME = {
	ok: true,
	data: {
		user: { id: 1, username: 'sapan', display_name: 'Sapan', email: 's@test.com', role: 'user' },
		scopes: [],
	},
};

beforeEach(() => {
	vi.restoreAllMocks();
});

function render_logs(search_body: unknown) {
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/v1/session/get')) {
			return new Response(JSON.stringify(MOCK_ME));
		}
		if (url.includes('/v1/orgs/get')) {
			return new Response(JSON.stringify({ ok: true, orgs: [{ id: 1, slug: 'sapan', display_name: 'Personal' }] }));
		}
		if (url.includes('/v1/runs/get_logs')) {
			return new Response(JSON.stringify(search_body));
		}
		return new Response(JSON.stringify({ ok: false }), { status: 404 });
	});

	return render(
		<MemoryRouter>
			<AuthProvider>
				<OrgProvider>
					<Run_logs_section run_id="run_test_1" realm_id="realm_test_1" live={false} />
				</OrgProvider>
			</AuthProvider>
		</MemoryRouter>,
	);
}

describe('Run_logs_section', () => {
	it('renders structured log lines from /v1/runs/get_logs', async () => {
		const t = Date.parse('2026-01-01T14:00:00Z');
		render_logs({
			ok: true,
			lines: [
				{
					id: 'l2',
					run_id: 'run_test_1',
					created_at: t + 1000,
					level: 'info',
					message: 'awaiting input',
					daemon_id: null,
					workspace_id: null,
					team: null,
					realm_id: 'realm_test_1',
				},
				{
					id: 'l1',
					run_id: 'run_test_1',
					created_at: t,
					level: 'info',
					message: 'phase intake completed',
					daemon_id: null,
					workspace_id: null,
					team: null,
					realm_id: 'realm_test_1',
				},
			],
			total: 2,
			facets: { level: [{ value: 'info', count: 2 }] },
		});
		await waitFor(() => expect(screen.getByText(/phase intake completed/)).toBeInTheDocument());
		expect(screen.getByText('Logs · this run')).toBeInTheDocument();
		expect(document.getElementById('logs')).toBeTruthy();
	});

	it('shows empty state when there are no log lines', async () => {
		render_logs({ ok: true, lines: [], total: 0, facets: {} });
		await waitFor(() =>
			expect(screen.getByText('No log lines on Hub for this run yet.')).toBeInTheDocument(),
		);
		expect(screen.getByText(/hub_connect.sync_logs/)).toBeInTheDocument();
	});

	it('shows error when API fails', async () => {
		render_logs({ ok: false, error: 'not found' });
		await waitFor(() => expect(screen.getByText('not found')).toBeInTheDocument());
	});
});
