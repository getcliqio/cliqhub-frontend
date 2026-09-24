import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { RootLayout } from '@/layouts/root_layout';

function render_layout() {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <RootLayout />,
      children: [
        { index: true, element: <div>test-content</div> },
      ],
    },
  ]);
  return render(<RouterProvider router={router} />);
}

describe('RootLayout', () => {
  it('renders navbar', () => {
    render_layout();
    expect(screen.getAllByText('CliqHub').length).toBeGreaterThanOrEqual(1);
  });

  it('renders child content via Outlet', () => {
    render_layout();
    expect(screen.getByText('test-content')).toBeInTheDocument();
  });

  it('renders footer with links', () => {
    render_layout();
    expect(screen.getByText('Get Cliq')).toBeInTheDocument();
    expect(screen.getByText('Docs')).toBeInTheDocument();
  });
});
