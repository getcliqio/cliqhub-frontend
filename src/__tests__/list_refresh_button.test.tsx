/**
 * Unit tests for the shared List_refresh_button used on the runs and
 * teams search bars. Guarantees the contract callers on those pages
 * rely on:
 *   - clicking invokes the loader once
 *   - `busy` disables the button (so back-to-back clicks can't stack
 *     duplicate requests behind an already-in-flight list load)
 *   - a specific aria-label survives (screen-reader affordance)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { List_refresh_button } from '@/components/ui/list_refresh_button';

describe('List_refresh_button', () => {
    it('calls on_click when clicked', () => {
        const on_click = vi.fn();
        render(<List_refresh_button on_click={on_click} label="Refresh runs" />);

        fireEvent.click(screen.getByRole('button', { name: /Refresh runs/i }));
        expect(on_click).toHaveBeenCalledTimes(1);
    });

    it('is disabled while busy and reports aria-busy', () => {
        const on_click = vi.fn();
        render(
            <List_refresh_button on_click={on_click} busy label="Refresh teams" />,
        );

        const button = screen.getByRole('button', { name: /Refresh teams/i });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('aria-busy', 'true');

        fireEvent.click(button);
        expect(on_click).not.toHaveBeenCalled();
    });

    it('does NOT report aria-busy when idle', () => {
        render(<List_refresh_button on_click={() => {}} label="Refresh" />);
        const button = screen.getByRole('button', { name: /Refresh/i });
        expect(button).not.toHaveAttribute('aria-busy');
        expect(button).not.toBeDisabled();
    });

    it('renders a spinning icon while busy', () => {
        const { container } = render(
            <List_refresh_button on_click={() => {}} busy label="Refresh" />,
        );
        // lucide-react renders an <svg>; the spin class lives on it.
        const svg = container.querySelector('svg');
        expect(svg).not.toBeNull();
        expect(svg?.getAttribute('class') ?? '').toMatch(/animate-spin/);
    });

    it('does NOT spin when idle', () => {
        const { container } = render(
            <List_refresh_button on_click={() => {}} label="Refresh" />,
        );
        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('class') ?? '').not.toMatch(/animate-spin/);
    });

    it('falls back to a generic label when none is provided', () => {
        render(<List_refresh_button on_click={() => {}} />);
        expect(
            screen.getByRole('button', { name: /Refresh list/i }),
        ).toBeInTheDocument();
    });
});
