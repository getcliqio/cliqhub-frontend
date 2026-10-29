/** Graphite shell: the org on screen (from the URL) is the org context's current org too. */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { gs_response, multi_org_overview, ORG_A } from './fixtures_overview';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} }, scopes: [], loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));
const org_ctx = { current_id: 'org-personal' as string | null, switch_org: vi.fn() };
vi.mock('@/lib/org_context', () => ({ useOrgOptional: () => org_ctx }));

import { Graphite_shell } from '@/components/graphite/graphite_shell';

function render_at(path: string) {
	const data = multi_org_overview();
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes><Route path="*" element={<Graphite_shell data={data} title="Teams"><p>page</p></Graphite_shell>} /></Routes>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	org_ctx.current_id = 'org-personal';
	org_ctx.switch_org.mockClear();
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => gs_response(url) ?? new Response(JSON.stringify({ ok: true, data: {} })));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Graphite shell — org context follows the org on screen', () => {
	it('a page of another org moves the org context to it (the channel picker then asks about that org)', async () => {
		const slug = multi_org_overview().orgs.find((o) => o.id === ORG_A)!.slug;
		render_at(`/teams?org=${slug}`);
		await waitFor(() => expect(org_ctx.switch_org).toHaveBeenCalledWith(ORG_A));
	});

	it('already on that org: nothing to change', async () => {
		org_ctx.current_id = ORG_A;
		const slug = multi_org_overview().orgs.find((o) => o.id === ORG_A)!.slug;
		render_at(`/teams?org=${slug}`);
		await new Promise((r) => setTimeout(r, 20));
		expect(org_ctx.switch_org).not.toHaveBeenCalled();
	});
});
