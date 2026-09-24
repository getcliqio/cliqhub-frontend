/**
 * Tests for ReviewClaimBanner — read-only claim status (no claim/unclaim HTTP).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { ReviewClaimBanner } from '@/components/review_claim_banner';

function make_props(overrides: Record<string, unknown> = {}) {
    return {
        reviewer_count: 3,
        claimed_by: null as string | null,
        current_user_id: '1',
        is_my_claim: false,
        ...overrides,
    };
}

describe('ReviewClaimBanner', () => {
    it('shows auto-claim hint when unclaimed + multiple reviewers', () => {
        render(
            <MemoryRouter>
                <ReviewClaimBanner {...make_props()} />
            </MemoryRouter>,
        );

        expect(screen.getByText('3 reviewers notified')).toBeTruthy();
        expect(screen.getByText(/Send a chat message to claim/)).toBeTruthy();
        expect(screen.queryByText("I'll take this")).toBeNull();
    });

    it('hidden when single reviewer', () => {
        const { container } = render(
            <MemoryRouter>
                <ReviewClaimBanner {...make_props({ reviewer_count: 1 })} />
            </MemoryRouter>,
        );

        expect(container.innerHTML).toBe('');
    });

    it('shows claimed-by-you state without release button', () => {
        render(
            <MemoryRouter>
                <ReviewClaimBanner
                    {...make_props({
                        claimed_by: '1',
                        is_my_claim: true,
                    })}
                />
            </MemoryRouter>,
        );

        expect(screen.getByText('You claimed this review.')).toBeTruthy();
        expect(screen.queryByText('Release claim')).toBeNull();
    });

    it('shows claimed-by-other state', () => {
        render(
            <MemoryRouter>
                <ReviewClaimBanner
                    {...make_props({
                        claimed_by: '2',
                        claimed_by_name: 'carlos',
                        is_my_claim: false,
                    })}
                />
            </MemoryRouter>,
        );

        expect(screen.getByText(/Claimed by/)).toBeTruthy();
        expect(screen.getByText('carlos')).toBeTruthy();
    });
});
