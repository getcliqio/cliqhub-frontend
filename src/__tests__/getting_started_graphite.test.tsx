import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Getting_started_view, steps_for } from '@/pages/getting_started_graphite_page';
import { gs_progress } from './fixtures_overview';

function view(done = 2) {
	return render(<MemoryRouter><Getting_started_view data={gs_progress(done) as never} /></MemoryRouter>);
}

describe('Getting started', () => {
	afterEach(() => vi.restoreAllMocks());

	it('shows progress and exactly one primary next step', () => {
		view(2);
		expect(screen.getByTestId('gs-progress')).toHaveTextContent('2 of 4 done.');
		expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuenow', '2');
		expect(screen.getByTestId('gs-step-cli')).toHaveAttribute('data-state', 'done');
		expect(screen.getByTestId('gs-step-daemon')).toHaveAttribute('data-state', 'done');
		expect(screen.getByTestId('gs-step-team')).toHaveAttribute('data-state', 'current');
		expect(screen.getByTestId('gs-step-run')).toHaveAttribute('data-state', 'todo');
		expect(within(screen.getByTestId('gs-step-team')).getByRole('link', { name: /Open Marketplace/ })).toHaveAttribute('href', '/browse');
		expect(within(screen.getByTestId('gs-step-run')).queryByRole('link')).toBeNull();
	});

	it('brand-new user starts at the CLI with copyable commands', () => {
		view(0);
		const cli = screen.getByTestId('gs-step-cli');
		expect(cli).toHaveAttribute('data-state', 'current');
		expect(cli).toHaveTextContent('cliq login');
		expect(within(cli).getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
	});

	it('all done → celebration and a way on', () => {
		view(4);
		expect(screen.getByText('You’re set up.')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Go to Overview' })).toHaveAttribute('href', '/home');
	});

	it('links the first run when known', () => {
		const d = { ...gs_progress(4), run: { done: true, run_id: 'run 1', realm: { org_slug: 'acme', slug: 'prod' } } };
		const s = steps_for(d as never);
		render(<MemoryRouter>{s[3].done_text}</MemoryRouter>);
		expect(screen.getByRole('link', { name: 'open it' })).toHaveAttribute('href', '/o/acme/realms/prod/runs/run%201');
	});
});
