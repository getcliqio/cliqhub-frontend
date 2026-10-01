/** Notifications › Custom events. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => ({ user: { id: 'u1' } }), useAuthFetch: () => stable_fetch }));

import { Custom_events_panel, custom_type } from '@/components/graphite/g_custom_events';

type Call = { url: string; body: Record<string, unknown> };
function route_fetch() {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/events/custom/list') return new Response(JSON.stringify({ ok: true, events: [
			{ id: 'e1', event_type: 'custom.deploy.approved', source: 'declared', realm_id: 'r1', team_slug: null, label: 'Deploy approved', created_at: 1 },
			{ id: 'e2', event_type: 'custom.lint.warned', source: 'observed', realm_id: null, team_slug: 'feature-dev', label: null, created_at: 1 },
			{ id: 'e3', event_type: 'custom.other', source: 'declared', realm_id: 'r-other', team_slug: null, label: null, created_at: 1 },
		] }));
		return new Response(JSON.stringify({ ok: true, data: { items: [], realms: [] } }));
	});
	return calls;
}
afterEach(() => vi.restoreAllMocks());

describe('Custom events', () => {
	it('custom_type normalises names', () => {
		expect(custom_type('Deploy Approved')).toBe('custom.deploy-approved');
		expect(custom_type('custom.x.y')).toBe('custom.x.y');
		expect(custom_type('  ')).toBe('');
	});

	it('lists the realm’s types (and realm-less ones read-only); declare and remove', async () => {
		const calls = route_fetch();
		render(<MemoryRouter><Custom_events_panel org_id="o1" initial={{ id: 'r1', slug: 'prod-us', org_slug: 'm1' }} /></MemoryRouter>);
		const declared = await screen.findByTestId('custom-custom.deploy.approved');
		expect(screen.getByTestId('custom-custom.lint.warned')).toHaveTextContent('all realms');
		expect(within(screen.getByTestId('custom-custom.lint.warned')).queryByRole('button')).toBeNull();
		expect(screen.queryByTestId('custom-custom.other')).toBeNull();
		fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'build.flaky' } });
		fireEvent.click(screen.getByRole('button', { name: 'Declare custom.build.flaky' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/events/custom/create')?.body).toEqual({ realm_id: 'r1', event_type: 'custom.build.flaky' }));
		fireEvent.click(within(declared).getByRole('button', { name: 'Remove…' }));
		fireEvent.click(within(screen.getByTestId('custom-custom.deploy.approved')).getByRole('button', { name: 'Remove' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/events/custom/remove')?.body).toEqual({ id: 'e1' }));
	});
});
