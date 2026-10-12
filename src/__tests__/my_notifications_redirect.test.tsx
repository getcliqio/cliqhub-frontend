/**
 * The old "My notifications" page is now the "Reaches you" filter on Events: its URL redirects
 * there and keeps the org you were viewing.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { My_notifications_redirect } from '@/router';

function Where() {
	const l = useLocation();
	return <p data-testid="where">{l.pathname}{l.search}</p>;
}

describe('/my-notifications', () => {
	it('opens Events › Rules on "Reaches you", keeping the org', () => {
		render(
			<MemoryRouter initialEntries={['/my-notifications?org=measureone']}>
				<Routes>
					<Route path="/my-notifications" element={<My_notifications_redirect />} />
					<Route path="/notifications" element={<Where />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByTestId('where')).toHaveTextContent('/notifications?org=measureone&show=reaches');
	});
});
