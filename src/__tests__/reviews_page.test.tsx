import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const auth_fetch = vi.fn();
const navigate = vi.fn();

vi.mock('@/lib/org_context', () => ({
	useOrgFetch: () => auth_fetch,
	useOrg: () => ({ current_org: { id: 1, slug: 'acme' }, orgs: [], is_multi_org: false, is_personal: false, loading: false, switch_org: () => {} }),
}));

vi.mock('react-router', async () => {
	const actual = await vi.importActual<typeof import('react-router')>('react-router');
	return {
		...actual,
		useNavigate: () => navigate,
	};
});

import { Component as ReviewsPage } from '@/pages/reviews_page';

describe('ReviewsPage', () => {
	beforeEach(() => {
		auth_fetch.mockReset();
		navigate.mockReset();
	});

	it('renders pending reviews with clickable rows and enriched columns', async () => {
		auth_fetch.mockResolvedValue({
			json: async () => ({
				ok: true,
				reviews: [{
					review_id: 'rev-abcdef012345',
					realm_id: 'realm-1',
					realm_name: 'sapan',
					realm_slug: 'sapan.default',
					run_id: 'run-abcd1234-5678',
					run_name: 'hug-ui-visible',
					phase: 'human-review',
					team: '@cliq/hello-hug',
					title: null,
					message: 'Awaiting human verdict',
					review_url: 'https://cliqhub.io/reviews/rev-abcdef012345',
					event: 'hug.review_requested',
					requested_at: Date.now() - 120_000,
					notification_id: 'n1',
					artifact_count: 2,
					status: 'pending',
					last_reminded_at: null,
				}],
			}),
		});

		render(
			<MemoryRouter>
				<ReviewsPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText(/human-review/)).toBeInTheDocument();
		});
		expect(screen.getByText('@cliq/hello-hug')).toBeInTheDocument();
		expect(screen.getByText('hug-ui-visible')).toBeInTheDocument();
		expect(screen.getByText('sapan.default')).toBeInTheDocument();

		fireEvent.click(screen.getByText(/human-review/));
		expect(navigate).toHaveBeenCalledWith('/reviews/rev-abcdef012345');

		expect(auth_fetch).toHaveBeenCalledWith(
			'/v1/reviews/get',
			expect.objectContaining({ method: 'POST' }),
		);
	});

	it('shows empty state when none pending', async () => {
		auth_fetch.mockResolvedValue({
			json: async () => ({ ok: true, reviews: [] }),
		});

		render(
			<MemoryRouter>
				<ReviewsPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText(/No open HUG reviews/i)).toBeInTheDocument();
			expect(screen.getByText(/All clear/i)).toBeInTheDocument();
		});
	});
});
