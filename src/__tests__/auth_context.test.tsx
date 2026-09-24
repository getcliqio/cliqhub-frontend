import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/lib/auth_context';

const MOCK_USER = {
  id: '1',
  username: 'admin',
  display_name: 'Admin',
  email: 'admin@test.com',
  role: 'admin',
};

function TestConsumer() {
  const { user, loading } = useAuth();
  if (loading) return <div>loading</div>;
  if (!user) return <div>unauthenticated</div>;
  return <div>user:{user.username}</div>;
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 401 }),
    );
    render(
      <AuthProvider>
        <div>child</div>
      </AuthProvider>,
    );
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  it('hydrates user from session on mount', async () => {
    const fetch_mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { user: MOCK_USER, scopes: [], acting_as: null } })),
    );

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await act(async () => {});

    expect(screen.getByText('user:admin')).toBeInTheDocument();
    expect(String(fetch_mock.mock.calls[0]?.[0])).toContain('/v1/session/get');
  });

  it('shows unauthenticated when no session exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 401 }),
    );

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await act(async () => {});

    expect(screen.getByText('unauthenticated')).toBeInTheDocument();
  });

  it('shows unauthenticated on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await act(async () => {});

    expect(screen.getByText('unauthenticated')).toBeInTheDocument();
  });
});

function ActionsConsumer() {
  const { login, signup, logout, refresh, user } = useAuth();
  return (
    <div>
      <button onClick={() => void login('admin', 'secret')}>login</button>
      <button onClick={() => void signup('admin', 'a@test.com', 'secret')}>signup</button>
      <button onClick={() => void logout()}>logout</button>
      <button onClick={() => void refresh()}>refresh</button>
      <span>{user ? `user:${user.username}` : 'unauthenticated'}</span>
    </div>
  );
}

describe('AuthProvider actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('login hydrates on success and returns error message on failure', async () => {
    const fetch_mock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: { message: 'bad creds' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        data: { user: MOCK_USER, scopes: [] },
      })));

    let login_error: string | null = 'unset';
    function LoginProbe() {
      const { login, user } = useAuth();
      return (
        <div>
          <button onClick={async () => { login_error = await login('admin', 'x'); }}>go</button>
          <span>{user ? `user:${user.username}` : 'unauthenticated'}</span>
        </div>
      );
    }

    render(<AuthProvider><LoginProbe /></AuthProvider>);
    await act(async () => {});
    await act(async () => {
      screen.getByText('go').click();
    });
    expect(login_error).toBe('bad creds');
    expect(String(fetch_mock.mock.calls[1]?.[0])).toContain('/v1/session/create');

    fetch_mock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    fetch_mock.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      data: { user: MOCK_USER, scopes: [], acting_as: null },
    })));
    await act(async () => {
      screen.getByText('go').click();
    });
    expect(login_error).toBeNull();
    expect(screen.getByText('user:admin')).toBeInTheDocument();
  });

  it('signup returns default error when message missing', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false })));

    let signup_error: string | null = 'unset';
    function SignupProbe() {
      const { signup } = useAuth();
      return <button onClick={async () => { signup_error = await signup('u', 'e', 'p'); }}>go</button>;
    }

    render(<AuthProvider><SignupProbe /></AuthProvider>);
    await act(async () => {});
    await act(async () => {
      screen.getByText('go').click();
    });
    expect(signup_error).toBe('Signup failed');
  });

  it('logout clears state even when the request fails', async () => {
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        data: { user: MOCK_USER, scopes: [] },
      })))
      .mockRejectedValueOnce(new Error('offline'));

    render(<AuthProvider><ActionsConsumer /></AuthProvider>);
    await act(async () => {});
    expect(screen.getByText('user:admin')).toBeInTheDocument();

    await act(async () => {
      screen.getByText('logout').click();
    });
    expect(screen.getByText('unauthenticated')).toBeInTheDocument();
    expect(window.location.href).toBe('/login');
  });
});

describe('useAuth', () => {
  it('throws when used outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow('useAuth must be used within AuthProvider');
    spy.mockRestore();
  });
});

describe('useAuthFetch', () => {
  it('logs out on 401 responses', async () => {
    const { useAuthFetch } = await import('@/lib/auth_context');
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        data: { user: MOCK_USER, scopes: [], acting_as: null },
      })))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));

    function FetchProbe() {
      const auth_fetch = useAuthFetch();
      return <button onClick={() => void auth_fetch('/v1/x', { method: 'GET' })}>go</button>;
    }

    render(<AuthProvider><FetchProbe /></AuthProvider>);
    await act(async () => {});
    await act(async () => {
      screen.getByText('go').click();
    });
    expect(window.location.href).toBe('/login');
  });
});

describe('AuthProvider act-as', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('act_as and stop_act_as call session/update', async () => {
    const acting_user = {
      id: '2',
      username: 'bob',
      display_name: 'Bob',
      email: 'bob@test.com',
      role: 'user',
    };
    const fetch_mock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        data: { user: MOCK_USER, scopes: [], acting_as: null },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        data: {
          user: acting_user,
          scopes: [],
          acting_as: { actor_id: '1', actor_username: 'admin' },
        },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        data: { user: MOCK_USER, scopes: [], acting_as: null },
      })));

    let act_error: string | null = 'unset';
    let stop_error: string | null = 'unset';
    function ActAsProbe() {
      const { act_as, stop_act_as, acting_as, user, user_id, act_as_user_id } = useAuth();
      return (
        <div>
          <button onClick={async () => { act_error = await act_as('2'); }}>enter</button>
          <button onClick={async () => { stop_error = await stop_act_as(); }}>exit</button>
          <span>
            {user ? `user:${user.username}` : 'none'}
            {' '}
            acting:{acting_as ? acting_as.actor_username : 'none'}
            {' '}
            ids:{user_id}:{act_as_user_id}
          </span>
        </div>
      );
    }

    render(<AuthProvider><ActAsProbe /></AuthProvider>);
    await act(async () => {});

    await act(async () => {
      screen.getByText('enter').click();
    });
    expect(act_error).toBeNull();
    expect(String(fetch_mock.mock.calls[1]?.[0])).toContain('/v1/session/update');
    const enter_init = fetch_mock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(enter_init.body))).toEqual({ act_as_user_id: '2' });
    expect(screen.getByText(/user:bob/)).toBeInTheDocument();
    expect(screen.getByText(/acting:admin/)).toBeInTheDocument();
    expect(screen.getByText(/ids:1:2/)).toBeInTheDocument();

    await act(async () => {
      screen.getByText('exit').click();
    });
    expect(stop_error).toBeNull();
    expect(String(fetch_mock.mock.calls[2]?.[0])).toContain('/v1/session/update');
    const exit_init = fetch_mock.mock.calls[2]?.[1] as RequestInit;
    expect(JSON.parse(String(exit_init.body))).toEqual({ act_as_user_id: null });
    expect(screen.getByText(/user:admin/)).toBeInTheDocument();
    expect(screen.getByText(/acting:none/)).toBeInTheDocument();
  });
});
