import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '@/lib/auth_context';
import { OrgProvider } from '@/lib/org_context';
import { HubActivityProvider } from '@/lib/hub_activity_context';
import { Component as RealmsPage } from '@/pages/account/realms_page';
import { PAGE_LIMIT } from '@/components/pagination';

const MOCK_ME = {
	ok: true,
	data: {
		user: { id: 1, username: 'sapan', display_name: 'Sapan', email: 's@test.com', role: 'user' },
		scopes: [],
		default_realm_slug: 'sapan',
	},
};

const REALMS = [
	{
		id: 'r1',
		slug: 'sapan',
		name: 'Personal',
		owner_user_id: '1',
		created_by: '1',
		created_by_username: 'sapan',
		created_at: 1_700_000_000_000,
		updated_at: 1_700_000_000_000,
	},
	{
		id: 'r2',
		slug: 'acme-prod',
		name: 'Acme Production',
		owner_user_id: '99',
		created_by: '99',
		created_by_username: 'alice',
		created_at: 1_700_000_100_000,
		updated_at: 1_700_000_100_000,
	},
];

beforeEach(() => {
	vi.restoreAllMocks();
	try { globalThis.localStorage?.setItem('cliqhub_current_org_id', 'org-sapan'); } catch { /* jsdom */ }
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.includes('/v1/session/get')) {
			return new Response(JSON.stringify(MOCK_ME));
		}
		if (url.includes('/v1/daemons/get') || url.includes('/v1/runs/get')) {
			return new Response(JSON.stringify({
				ok: true,
				daemons: [{ id: 'd1' }],
				data: { items: [{ run_id: 'r1' }], total: 1 },
			}));
		}
		if (url.includes('/v1/orgs/get')) {
			return new Response(JSON.stringify({
				ok: true,
				data: { orgs: [{ id: 'org-sapan', slug: 'sapan', display_name: 'Personal' }] },
			}));
		}
		if (url.includes('/v1/realms/get')) {
			const body = JSON.parse(String(init?.body ?? '{}')) as {
				query?: string;
				owned?: string;
				sort_by?: string;
				sort_dir?: string;
				limit?: number;
				offset?: number;
			};
			let rows = [...REALMS];
			if (body.owned === 'me') {
				rows = rows.filter((r) => r.owner_user_id === '1' || r.created_by === '1');
			}
			if (body.owned === 'default') {
				rows = rows.filter((r) => r.slug === 'sapan');
			}
			if (body.query) {
				const q = body.query.toLowerCase();
				rows = rows.filter(
					(r) => r.slug.includes(q) || r.name.toLowerCase().includes(q),
				);
			}
			if (body.sort_by === 'name' && body.sort_dir === 'desc') {
				rows = [...rows].sort((a, b) => b.name.localeCompare(a.name));
			}
			const offset = body.offset ?? 0;
			const limit = body.limit ?? PAGE_LIMIT;
			const page = rows.slice(offset, offset + limit);
			return new Response(JSON.stringify({ ok: true, realms: page, total: rows.length }));
		}
		return new Response(JSON.stringify({ ok: false }), { status: 404 });
	});
});

function render_realms(path = '/realms') {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<AuthProvider>
				<OrgProvider>
					<HubActivityProvider>
						<Routes>
							<Route path="/realms" element={<RealmsPage />} />
						</Routes>
					</HubActivityProvider>
				</OrgProvider>
			</AuthProvider>
		</MemoryRouter>,
	);
}

function last_realms_get_body(): Record<string, unknown> {
	const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
		.map((c) => ({ url: String(c[0]), init: c[1] as RequestInit | undefined }))
		.filter((c) => c.url.includes('/v1/realms/get'));
	const last = calls[calls.length - 1];
	return JSON.parse(String(last?.init?.body ?? '{}'));
}

describe('realms_page list + filters', () => {
	it('renders a table list, not cards', async () => {
		render_realms();
		await waitFor(() => expect(screen.getByText('Acme Production')).toBeInTheDocument());
		expect(screen.getByRole('table')).toBeInTheDocument();
		expect(screen.getByText('Personal')).toBeInTheDocument();
		expect(screen.getByText('Filters')).toBeInTheDocument();
		expect(document.querySelector('ul.grid')).toBeNull();
	});

	it('sends owned=me to /v1/realms/get', async () => {
		render_realms('/realms?owned=me');
		await waitFor(() => expect(screen.getByText('Personal')).toBeInTheDocument());
		expect(screen.queryByText('Acme Production')).not.toBeInTheDocument();
		expect(screen.getByText('owned: me')).toBeInTheDocument();
		expect(last_realms_get_body().owned).toBe('me');
		await waitFor(() => {
			expect(last_realms_get_body().org_id).toBe('org-sapan');
		});
	});

	it('applies search draft on change via API body', async () => {
		render_realms();
		await waitFor(() => expect(screen.getByText('Acme Production')).toBeInTheDocument());

		const input = screen.getByLabelText('Filter realms by slug or name');
		fireEvent.change(input, { target: { value: 'acme' } });

		await waitFor(() => {
			expect(last_realms_get_body().query).toBe('acme');
		});
	});

	it('sorts via server sort_by on header click', async () => {
		render_realms();
		await waitFor(() => expect(screen.getByText('Acme Production')).toBeInTheDocument());

		fireEvent.click(screen.getByRole('button', { name: 'Sort by Realm' }));

		await waitFor(() => {
			const body = last_realms_get_body();
			expect(body.sort_by).toBe('name');
			expect(body.sort_dir).toBe('asc');
			expect(body.limit).toBe(PAGE_LIMIT);
		});
	});
});
