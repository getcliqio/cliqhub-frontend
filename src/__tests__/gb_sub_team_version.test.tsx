/** Builder: a sub-team phase's version — latest, or one published version pinned (PLAN-team-bundle S8). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuthFetch: () => stable_fetch }));

import { Sub_team_version, parse_sub_team_ref } from '@/components/gbuilder/gb_inspector';

afterEach(() => vi.restoreAllMocks());

function versions_reply(versions: string[] | null) {
	const calls: unknown[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
		calls.push(JSON.parse(String(init?.body)));
		return versions
			? new Response(JSON.stringify({ ok: true, data: { versions: versions.map((version) => ({ id: `id-${version}`, version })) } }))
			: new Response(JSON.stringify({ ok: false, error: { message: 'Team not found' } }), { status: 404 });
	});
	return calls;
}

describe('sub-team version', () => {
	it('parses refs: a pin, @latest and none', () => {
		expect(parse_sub_team_ref('@acme/leaf@1.2.0')).toEqual({ scope: 'acme', slug: 'leaf', version: '1.2.0' });
		expect(parse_sub_team_ref('acme/leaf@latest')).toEqual({ scope: 'acme', slug: 'leaf', version: null });
		expect(parse_sub_team_ref('@acme/leaf')).toEqual({ scope: 'acme', slug: 'leaf', version: null });
		expect(parse_sub_team_ref('@acme')).toBeNull();
	});

	it('lists the published versions; picking one pins it, latest unpins it', async () => {
		const calls = versions_reply(['2.0.0', '1.0.0']);
		const on_change = vi.fn();
		render(<Sub_team_version value="@acme/leaf" on_change={on_change} />);
		await waitFor(() => expect(screen.getByRole('option', { name: '1.0.0' })).toBeInTheDocument());
		expect(calls).toEqual([{ scope: 'acme', name: 'leaf' }]);
		const select = screen.getByLabelText('Sub-team version');
		expect(select).toHaveValue('');
		fireEvent.change(select, { target: { value: '1.0.0' } });
		expect(on_change).toHaveBeenLastCalledWith('@acme/leaf@1.0.0');
	});

	it('a pin shows as chosen; one CliqHub doesn\'t have is marked; an unknown team says none is published', async () => {
		versions_reply(['2.0.0']);
		const on_change = vi.fn();
		const { unmount } = render(<Sub_team_version value="@acme/leaf@9.9.9" on_change={on_change} />);
		await waitFor(() => expect(screen.getByRole('option', { name: '9.9.9 (not published)' })).toBeInTheDocument());
		expect(screen.getByLabelText('Sub-team version')).toHaveValue('9.9.9');
		fireEvent.change(screen.getByLabelText('Sub-team version'), { target: { value: '' } });
		expect(on_change).toHaveBeenLastCalledWith('@acme/leaf');
		unmount();
		vi.restoreAllMocks();
		versions_reply(null);
		render(<Sub_team_version value="@acme/ghost" on_change={vi.fn()} />);
		expect(await screen.findByText('No published version of @acme/ghost found.')).toBeInTheDocument();
	});

	it('shows nothing until the text is a team ref', () => {
		versions_reply([]);
		const { container } = render(<Sub_team_version value="@acme" on_change={vi.fn()} />);
		expect(container).toBeEmptyDOMElement();
	});
});
