/** Legacy /runs, /daemons, /logs land in the caller's default realm (from session/get). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuthFetch: () => stable_fetch }));

import { Realm_runtime_redirect } from '@/pages/account/realm_runtime_redirect';

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; }

function session_returns(data: Record<string, unknown>) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ok: true, data })));
}

function at(path: string, pattern: string, section: 'runs' | 'daemons' | 'logs') {
	render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path={pattern} element={<Realm_runtime_redirect section={section} />} />
				<Route path="*" element={<Where />} />
			</Routes>
		</MemoryRouter>,
	);
}

afterEach(() => { vi.restoreAllMocks(); });

describe('Realm_runtime_redirect', () => {
	it('sends /runs/:run_id to the default realm, keeping the query', async () => {
		const spy = session_returns({ default_realm_qualified: 'acme.prod' });
		at('/runs/r-1?tab=logs', '/runs/:run_id', 'runs');
		await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/o/acme/realms/prod/runs/r-1?tab=logs'));
		expect(spy.mock.calls[0][0]).toBe('/v1/session/get');
	});

	it('sends /daemons to the default realm daemons', async () => {
		session_returns({ default_realm_qualified: 'acme.prod' });
		at('/daemons', '/daemons', 'daemons');
		await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/o/acme/realms/prod/daemons'));
	});

	it('falls back to /realms without a default realm', async () => {
		session_returns({ default_realm_qualified: null });
		at('/logs', '/logs', 'logs');
		await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/realms'));
	});
});
