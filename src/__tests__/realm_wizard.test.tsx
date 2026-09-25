/**
 * Realm create wizard — body org_id hard-cut (RM-3).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const auth_fetch = vi.fn();
const org_state = {
	current_org: { id: 'org-acme', slug: 'acme', display_name: 'Acme' } as {
		id: string; slug: string; display_name: string;
	} | null,
	current_id: 'org-acme' as string | null,
	loading: false,
};

vi.mock('@/lib/org_context', () => ({
	useOrgFetch: () => auth_fetch,
	useOrg: () => ({
		current_org: org_state.current_org,
		current_id: org_state.current_id,
		orgs: org_state.current_org ? [org_state.current_org] : [],
		is_multi_org: false,
		is_personal: false,
		loading: org_state.loading,
		switch_org: vi.fn(),
	}),
}));

import { Realm_wizard } from '@/components/realm_wizard';

function render_wizard() {
	return render(
		<MemoryRouter>
			<Realm_wizard on_cancel={vi.fn()} on_done={vi.fn()} />
		</MemoryRouter>,
	);
}

describe('Realm_wizard create org_id', () => {
	beforeEach(() => {
		auth_fetch.mockReset();
		org_state.current_org = { id: 'org-acme', slug: 'acme', display_name: 'Acme' };
		org_state.current_id = 'org-acme';
		org_state.loading = false;
	});

	it('POSTs /v1/realms/create with org_id in the body', async () => {
		auth_fetch.mockResolvedValueOnce({
			json: async () => ({
				ok: true,
				realm: { id: 'r1', slug: 'prod-west', name: 'Prod West', org_slug: 'acme' },
			}),
		});
		// teams step may fire a teams/get — ignore subsequent calls
		auth_fetch.mockResolvedValue({
			json: async () => ({ ok: true, teams: [] }),
		});

		render_wizard();
		fireEvent.change(screen.getByPlaceholderText('prod-west'), { target: { value: 'prod-west' } });
		fireEvent.change(screen.getByPlaceholderText('Prod West'), { target: { value: 'Prod West' } });
		fireEvent.click(screen.getByRole('button', { name: 'Create & continue' }));

		await waitFor(() => {
			expect(auth_fetch).toHaveBeenCalledWith(
				'/v1/realms/create',
				expect.objectContaining({ method: 'POST' }),
			);
		});

		const create_call = auth_fetch.mock.calls.find((c) => String(c[0]).includes('/v1/realms/create'));
		expect(create_call).toBeTruthy();
		const body = JSON.parse(String((create_call![1] as RequestInit).body));
		expect(body).toEqual({
			org_id: 'org-acme',
			slug: 'prod-west',
			name: 'Prod West',
		});
	});

	it('fails closed when current_id is null (no POST)', async () => {
		org_state.current_id = null;
		org_state.current_org = null;
		render_wizard();
		fireEvent.change(screen.getByPlaceholderText('prod-west'), { target: { value: 'prod-west' } });
		fireEvent.change(screen.getByPlaceholderText('Prod West'), { target: { value: 'Prod West' } });
		const create_btn = screen.getByRole('button', { name: 'Create & continue' });
		expect(create_btn).toBeDisabled();
		fireEvent.click(create_btn);

		expect(auth_fetch).not.toHaveBeenCalled();
	});

	it('disables create while org context is loading', () => {
		org_state.loading = true;
		org_state.current_id = null;
		org_state.current_org = null;
		render_wizard();
		expect(screen.getByRole('button', { name: 'Loading workspace…' })).toBeDisabled();
	});
});
