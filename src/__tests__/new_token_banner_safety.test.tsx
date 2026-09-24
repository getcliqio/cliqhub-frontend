/**
 * Slice 5.6 — NewTokenBanner safety-modal behaviour.
 *
 * The banner reveals a token that the API will never show again.
 * The user needs to actually copy it somewhere. Pins:
 *   • When on_dismiss is set, a checkbox + Done button appear.
 *   • Done is disabled until the checkbox is ticked.
 *   • Ticking + Done fires on_dismiss exactly once.
 *   • Without on_dismiss the classic "always-visible" reveal
 *     renders (backward-compat for wizard callers).
 *   • permissions_summary renders when provided.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NewTokenBanner } from '@/components/new_token_banner';

describe('NewTokenBanner — dismissible (safety) mode', () => {
    it('renders the checkbox + Done button when on_dismiss is set', () => {
        render(<NewTokenBanner token="cliq_tok_abc" on_dismiss={vi.fn()} />);
        expect(screen.getByTestId('new-token-saved-checkbox')).toBeInTheDocument();
        expect(screen.getByTestId('new-token-done-button')).toBeInTheDocument();
    });

    it('Done is disabled until the "I have saved this" checkbox is ticked', () => {
        render(<NewTokenBanner token="cliq_tok_abc" on_dismiss={vi.fn()} />);
        const done = screen.getByTestId('new-token-done-button') as HTMLButtonElement;
        expect(done.disabled).toBe(true);

        fireEvent.click(screen.getByTestId('new-token-saved-checkbox'));
        expect(done.disabled).toBe(false);
    });

    it('clicking Done after ticking fires on_dismiss exactly once', () => {
        const on_dismiss = vi.fn();
        render(<NewTokenBanner token="cliq_tok_abc" on_dismiss={on_dismiss} />);

        fireEvent.click(screen.getByTestId('new-token-saved-checkbox'));
        fireEvent.click(screen.getByTestId('new-token-done-button'));

        expect(on_dismiss).toHaveBeenCalledTimes(1);
    });

    it('unticking after ticking re-disables Done (users can change their mind)', () => {
        render(<NewTokenBanner token="cliq_tok_abc" on_dismiss={vi.fn()} />);
        const done = screen.getByTestId('new-token-done-button') as HTMLButtonElement;
        const check = screen.getByTestId('new-token-saved-checkbox');

        fireEvent.click(check);
        expect(done.disabled).toBe(false);
        fireEvent.click(check);
        expect(done.disabled).toBe(true);
    });

    it('renders permissions_summary when provided', () => {
        render(
            <NewTokenBanner
                token="cliq_tok_abc"
                on_dismiss={vi.fn()}
                permissions_summary={<span>SCOPE:dispatch</span>}
            />,
        );
        const summary = screen.getByTestId('new-token-permissions-summary');
        expect(summary.textContent).toContain('SCOPE:dispatch');
    });

    it('still renders the token itself + Copy button in safety mode', () => {
        // The safety additions must not remove the primary affordance.
        render(<NewTokenBanner token="cliq_tok_xyz" on_dismiss={vi.fn()} />);
        expect(screen.getByText('cliq_tok_xyz')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Copy$/i })).toBeInTheDocument();
    });
});

describe('NewTokenBanner — classic mode (no on_dismiss)', () => {
    it('does NOT render the checkbox or Done button when on_dismiss is omitted', () => {
        // Wizard callers (realm_wizard, realm_detail_page) rely on
        // this: the banner stays visible until the surrounding page
        // clears its own state.
        render(<NewTokenBanner token="cliq_tok_abc" env_var="CLIQ_DAEMON_TOKEN" />);
        expect(screen.queryByTestId('new-token-saved-checkbox')).toBeNull();
        expect(screen.queryByTestId('new-token-done-button')).toBeNull();
    });

    it('does not render the permissions-summary slot when no summary is passed', () => {
        render(<NewTokenBanner token="cliq_tok_abc" />);
        expect(screen.queryByTestId('new-token-permissions-summary')).toBeNull();
    });
});
