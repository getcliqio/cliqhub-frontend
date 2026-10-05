import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { RootLayout } from '@/layouts/root_layout';

function render_layout(path = '/somewhere') {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <RootLayout />,
      children: [
        { index: true, element: <div>landing-content</div> },
        { path: 'somewhere', element: <div>test-content</div> },
        { path: 'browse', element: <div>browse-content</div> },
        { path: 'invite/:token', element: <div>invite-content</div> },
      ],
    },
  ], { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('RootLayout', () => {
  it('renders navbar on signed-out marketing pages', () => {
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

  it('landing and invite pages bring their own (Graphite) chrome', () => {
    const { unmount } = render_layout('/');
    expect(screen.getByText('landing-content')).toBeInTheDocument();
    expect(screen.queryByText('Get Cliq')).toBeNull();
    unmount();
    render_layout('/invite/abc');
    expect(screen.getByText('invite-content')).toBeInTheDocument();
    expect(screen.queryByText('Get Cliq')).toBeNull();
  });

  it('the Marketplace brings its own (Graphite) chrome — no second header', () => {
    render_layout('/browse');
    expect(screen.getByText('browse-content')).toBeInTheDocument();
    expect(screen.queryByText('Get Cliq')).toBeNull();
  });
});
