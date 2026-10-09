import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Route_error } from '@/components/graphite/g_route_error';

function Boom(): never { throw new TypeError('e.slice is not a function'); }

describe('Route_error', () => {
	it('a page that throws shows our error page (message, Reload, Go home, Copy details), not the developer screen', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const router = createMemoryRouter([{ path: '/settings', element: <Boom />, errorElement: <Route_error /> }], { initialEntries: ['/settings?tab=tokens'] });
		render(<RouterProvider router={router} />);
		const page = screen.getByTestId('route-error');
		expect(page).toHaveTextContent('Something went wrong on this page');
		expect(page).toHaveTextContent('e.slice is not a function');
		expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/home');
		expect(screen.getByRole('button', { name: 'Copy details' })).toBeInTheDocument();
		expect(screen.queryByText(/Hey developer/)).toBeNull();
	});
});
