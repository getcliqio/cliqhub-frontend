/** Realms list + New realm wizard (Graphite). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { gs_response, multi_org_overview } from './fixtures_overview';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan', email: 's@x.com', role: 'user' as const, preferences: {} }, scopes: [], loading: false, logout: vi.fn(), refresh: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as RealmsPage, slugify } from '@/pages/realms/realms_page';

type Call = { url: string; body: Record<string, unknown> };
function route_fetch(extra: Record<string, (b: Record<string, unknown>) => unknown> = {}) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (extra[u]) return new Response(JSON.stringify({ ok: true, ...(extra[u](body) as object) }));
		return new Response(JSON.stringify({ ok: true, data: {} }));
	});
	return calls;
}
function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div>; }
function open(path = '/realms') {
	return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/realms" element={<RealmsPage />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
}
afterEach(() => vi.restoreAllMocks());

describe('Realms page', () => {
	it('slugify', () => { expect(slugify('Production US!')).toBe('production-us'); });

	it('the org’s realms with health (no other orgs, no org filter); search narrows', async () => {
		route_fetch();
		open();
		expect(await screen.findByTestId('realm-prod-us')).toHaveTextContent('5/6');
		expect(within(screen.getByTestId('realm-prod-us')).getByText('4 need you')).toBeInTheDocument();
		expect(screen.queryByTestId('realm-sandbox')).toBeNull();
		expect(screen.queryByRole('button', { name: /Acme Labs/ })).toBeNull();
		fireEvent.change(screen.getByLabelText('Search realms'), { target: { value: 'stag' } });
		expect(screen.getByTestId('realm-staging')).toBeInTheDocument();
		expect(screen.queryByTestId('realm-prod-us')).toBeNull();
	});

	it('new realm: create → toggle a team → invite → mint token → open realm', async () => {
		const calls = route_fetch({
			'/v1/realms/create': () => ({ realm: { id: 'r-new', slug: 'qa', name: 'QA', org_slug: 'measureone' } }),
			'/v1/teams/get': () => ({ data: { teams: [{ scope: 'measureone', name: 'feature-dev' }] } }),
			'/v1/auth/generate_token': () => ({ data: { token: 'cliq_rt_abc' } }),
			'/v1/invitations/create': () => ({ data: { invite_id: 'inv-1', status: 'pending', email: 'kim@x.com', role: 'operator', expires_at: '2026-10-16T00:00:00Z', resent: false, email_sent: true, invite_url: null } }),
		});
		open('/realms?new=1');
		// only orgs you own/admin are offered: measureone
		fireEvent.change(await screen.findByLabelText('Realm name'), { target: { value: 'QA' } });
		expect(screen.getByLabelText('Realm slug')).toHaveValue('qa');
		expect(screen.queryByLabelText('Organization')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Create realm' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/realms/create')?.body).toEqual({ org_id: expect.any(String), slug: 'qa', name: 'QA' }));
		fireEvent.click(await screen.findByRole('checkbox'));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/realms/add_team')?.body).toEqual({ realm_id: 'r-new', scope: 'measureone', slug: 'feature-dev' }));
		fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'kim@x.com' } });
		fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/invitations/create')?.body).toEqual({ target_type: 'realm', realm_id: 'r-new', email: 'kim@x.com', role: 'operator' }));
		expect(await screen.findByTestId('sent-result')).toHaveTextContent('Invite sent to kim@x.com.');
		expect(screen.getByText('✓ kim@x.com (invited) · operator')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Create enrollment token' }));
		const reveal = await screen.findByTestId('secret-reveal');
		expect(within(reveal).getByText(/cliq_rt_abc/)).toBeInTheDocument();
		expect(calls.find((c) => c.url === '/v1/auth/generate_token')?.body).toEqual({ type: 'realm', realm_ids: ['r-new'], name: 'qa-enroll' });
	});

	it('new realm invite without email set up shows the link to copy', async () => {
		route_fetch({
			'/v1/realms/create': () => ({ realm: { id: 'r-new', slug: 'qa', name: 'QA', org_slug: 'measureone' } }),
			'/v1/teams/get': () => ({ data: { teams: [] } }),
			'/v1/invitations/create': () => ({ data: { invite_id: 'inv-1', status: 'pending', email: 'kim@x.com', role: 'operator', expires_at: '2026-10-16T00:00:00Z', resent: true, email_sent: false, invite_url: 'https://app.example.test/invite/kim' } }),
		});
		open('/realms?new=1');
		fireEvent.change(await screen.findByLabelText('Realm name'), { target: { value: 'QA' } });
		fireEvent.click(screen.getByRole('button', { name: 'Create realm' }));
		fireEvent.change(await screen.findByLabelText('Person'), { target: { value: 'kim@x.com' } });
		fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
		expect(await screen.findByTestId('fallback-url')).toHaveTextContent('https://app.example.test/invite/kim');
	});
});
