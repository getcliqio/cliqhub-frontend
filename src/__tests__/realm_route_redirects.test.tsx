import { describe, it, expect } from 'vitest';
import { MemoryRouter, Route, Routes, Navigate } from 'react-router';
import { render, screen } from '@testing-library/react';

describe('realm route redirects (5a)', () => {
	it('index redirects to teams', () => {
		render(
			<MemoryRouter initialEntries={['/o/acme/realms/acme-prod']}>
				<Routes>
					<Route path="/o/:org/realms/:slug">
						<Route index element={<Navigate to="teams" replace />} />
						<Route path="teams" element={<p>teams-dest</p>} />
					</Route>
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByText('teams-dest')).toBeInTheDocument();
	});

	it('logs redirects to runs', () => {
		render(
			<MemoryRouter initialEntries={['/o/acme/realms/acme-prod/logs']}>
				<Routes>
					<Route path="/o/:org/realms/:slug">
						<Route path="logs" element={<Navigate to="../runs" replace />} />
						<Route path="runs" element={<p>runs-dest</p>} />
					</Route>
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByText('runs-dest')).toBeInTheDocument();
	});
});
