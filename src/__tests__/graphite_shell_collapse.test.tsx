/** Graphite shell: the sidebar collapses to an icon rail, remembers the choice, and auto-collapses in the builder. */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { gs_response, multi_org_overview, ORG_A } from './fixtures_overview';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} }, scopes: [], loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Graphite_shell, SIDEBAR_KEY, auto_collapse } from '@/components/graphite/graphite_shell';
import type { Overview_data } from '@/lib/overview';

function overview(): Overview_data {
	const d = multi_org_overview();
	d.orgs = d.orgs.map((o) => (o.id === ORG_A ? { ...o, counts: { ...o.counts, needs_you: 3 } } : o));
	return d;
}

function Page({ name }: { name: string }) {
	return (
		<Graphite_shell data={overview()} title={name}>
			<p>{name}</p>
			<Link to="/builder">to builder</Link>
			<Link to={`/teams?org=${overview().orgs.find((o) => o.id === ORG_A)!.slug}`}>to teams</Link>
		</Graphite_shell>
	);
}

function render_at(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/builder" element={<Page name="builder" />} />
				<Route path="*" element={<Page name="other" />} />
			</Routes>
		</MemoryRouter>,
	);
}

const sidebar = () => screen.getByTestId('sidebar');
const collapsed = () => sidebar().dataset.collapsed === 'true';
const org_slug = () => overview().orgs.find((o) => o.id === ORG_A)!.slug;

beforeEach(() => {
	try { localStorage.removeItem(SIDEBAR_KEY); } catch { /* none */ }
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => gs_response(url) ?? new Response(JSON.stringify({ ok: true, data: {} })));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Graphite shell — collapsible sidebar', () => {
	it('auto_collapse is only for the team builder', () => {
		expect(auto_collapse('/builder')).toBe(true);
		expect(auto_collapse('/builder/x')).toBe(true);
		expect(auto_collapse('/builders')).toBe(false);
		expect(auto_collapse('/teams')).toBe(false);
	});

	it('collapses to an icon rail with tooltips and badges, and remembers the choice', () => {
		const { unmount } = render_at(`/home?org=${org_slug()}`);
		expect(collapsed()).toBe(false);
		fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
		expect(collapsed()).toBe(true);
		expect(localStorage.getItem(SIDEBAR_KEY)).toBe('1');
		const rail = screen.getByTestId('sidebar-rail');
		// icons keep an accessible name and a tooltip; the badge is still there
		const hugs = screen.getByRole('link', { name: 'HUGs (3)' });
		expect(hugs.getAttribute('title')).toBe('HUGs (3)');
		expect(rail.contains(hugs)).toBe(true);
		expect(screen.getByTestId('rail-badge').textContent).toBe('3');
		expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
		// the org switcher shrinks to the org chip and still opens
		const sw = screen.getByTestId('view-switcher');
		expect(sw.textContent).not.toContain('Organization');
		fireEvent.click(sw);
		expect(screen.getByRole('dialog', { name: 'Switch organization' })).toBeTruthy();
		unmount();
		// a new page load keeps it collapsed
		render_at(`/home?org=${org_slug()}`);
		expect(collapsed()).toBe(true);
		fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
		expect(collapsed()).toBe(false);
		expect(localStorage.getItem(SIDEBAR_KEY)).toBe('0');
	});

	it('auto-collapses in the builder, can be expanded there, and restores the previous state on leaving', () => {
		render_at(`/home?org=${org_slug()}`);
		expect(collapsed()).toBe(false);
		fireEvent.click(screen.getByText('to builder'));
		expect(screen.getByText('builder', { selector: 'p' })).toBeTruthy();
		expect(collapsed()).toBe(true);
		// expanding inside the builder does not change the remembered choice
		fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
		expect(collapsed()).toBe(false);
		expect(localStorage.getItem(SIDEBAR_KEY)).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
		expect(collapsed()).toBe(true);
		fireEvent.click(screen.getByText('to teams'));
		expect(screen.getByText('other', { selector: 'p' })).toBeTruthy();
		expect(collapsed()).toBe(false);
	});

	it('a remembered collapsed rail stays collapsed after the builder', () => {
		localStorage.setItem(SIDEBAR_KEY, '1');
		render_at('/builder');
		expect(collapsed()).toBe(true);
		fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
		fireEvent.click(screen.getByText('to teams'));
		expect(collapsed()).toBe(true);
	});

	it('works when storage is unavailable', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
		render_at(`/home?org=${org_slug()}`);
		expect(collapsed()).toBe(false);
		fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
		expect(collapsed()).toBe(true);
	});
});
