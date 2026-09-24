import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { NavBar } from '@/components/nav_bar';
import { AuthProvider } from '@/lib/auth_context';

const MOCK_ME = {
  ok: true,
  data: {
    user: { id: 1, username: 'admin', display_name: 'Admin', email: 'admin@test.com', role: 'admin' },
    scopes: [],
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(MOCK_ME)),
  );
});

async function render_nav() {
  render(
    <MemoryRouter>
      <AuthProvider>
        <NavBar />
      </AuthProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('Build')).toBeInTheDocument());
}

describe('NavBar', () => {
  it('renders CliqHub brand link', async () => {
    await render_nav();
    expect(screen.getByText('CliqHub')).toBeInTheDocument();
  });

  it('shows Build link for authenticated user', async () => {
    await render_nav();
    expect(screen.getByText('Build')).toBeInTheDocument();
  });

  it('shows user avatar for authenticated user', async () => {
    await render_nav();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('shows login CTA when unauthenticated', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 401 }),
    );
    render(
      <MemoryRouter>
        <AuthProvider>
          <NavBar />
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Log in')).toBeInTheDocument());
    expect(screen.getByText(/Get Cliq/)).toBeInTheDocument();
  });

  it('opens admin menu and closes on outside click', async () => {
    await render_nav();
    fireEvent.click(screen.getByText('admin'));
    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
    expect(screen.getByText('Site Admin')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument());
  });
});
