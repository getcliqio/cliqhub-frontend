/** Graphite shell: the HUGs badge counts the Hugs waiting on the person in the org on screen (PLAN-gethugs-partner-ux.md §1). */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { gs_response, multi_org_overview, ORG_A, ORG_B } from './fixtures_overview';
import { LAST_ORG_KEY } from '@/lib/view_scope';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} }, scopes: [], loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));
vi.mock('@/lib/org_context', () => ({ useOrgOptional: () => ({ current_id: null, switch_org: vi.fn() }) }));

import { Graphite_shell } from '@/components/graphite/graphite_shell';

let waiting: Record<string, unknown> = { total: 3, items: [] };
const asked: Array<Record<string, unknown>> = [];

function render_at(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes><Route path="*" element={<Graphite_shell data={multi_org_overview()} title="Teams"><p>page</p></Graphite_shell>} /></Routes>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	asked.length = 0;
	waiting = { total: 3, items: [] };
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		if (String(url) === '/v1/hugs/get') {
			asked.push(JSON.parse(String(init?.body)));
			return new Response(JSON.stringify({ ok: true, data: waiting }));
		}
		return gs_response(url) ?? new Response(JSON.stringify({ ok: true, data: {} }));
	});
});
afterEach(() => { vi.restoreAllMocks(); });

const slug = () => multi_org_overview().orgs.find((o) => o.id === ORG_A)!.slug;

describe('Graphite shell — the HUGs badge', () => {
	it('asks Core for the org on screen and shows the count on HUGs', async () => {
		render_at(`/teams?org=${slug()}`);
		await waitFor(() => expect(screen.getByRole('link', { name: /HUGs/ })).toHaveTextContent('3'));
		expect(asked[0]).toEqual({ unanswered: true, org_id: ORG_A, limit: 1 });
	});

	it('nothing waiting, or getHugs not reachable (total null): no badge', async () => {
		waiting = { total: 0, items: [] };
		const { unmount } = render_at(`/teams?org=${slug()}`);
		await waitFor(() => expect(asked.length).toBeGreaterThan(0));
		expect(screen.getByRole('link', { name: /HUGs/ })).toHaveTextContent(/^HUGs$/);
		unmount();
		waiting = { total: null, items: [] };
		render_at(`/teams?org=${slug()}`);
		await waitFor(() => expect(asked.length).toBeGreaterThan(1));
		expect(screen.getByRole('link', { name: /HUGs/ })).toHaveTextContent(/^HUGs$/);
	});

	it('no org in view ("all orgs"): the org last worked in, else the first', async () => {
		const orgs = multi_org_overview().orgs;
		const b = orgs.find((o) => o.id === ORG_B)!;
		localStorage.setItem(LAST_ORG_KEY, b.slug);
		const first = render_at('/teams');
		await waitFor(() => expect(asked.length).toBeGreaterThan(0));
		expect(asked.at(-1)!.org_id).toBe(ORG_B);
		first.unmount();
		localStorage.removeItem(LAST_ORG_KEY);
		asked.length = 0;
		render_at('/teams');
		await waitFor(() => expect(asked.length).toBeGreaterThan(0));
		expect(asked.at(-1)!.org_id).toBe(orgs[0]!.id);
	});
});
