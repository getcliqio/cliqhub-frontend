import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface ClientUser {
  id: string;
  username: string;
  display_name: string;
  email: string;
  role: 'user' | 'admin';
  preferences: Record<string, unknown>;
}

export interface ClientScope {
  id: number;
  slug: string;
  display_name: string;
  visibility: 'public' | 'private';
  scope_type: 'user' | 'org';
}

/** Present when act_as_user_id !== user_id (admin operating as another account). */
export interface ClientActingAs {
  actor_id: string;
  actor_username: string;
}

interface AuthState {
  user: ClientUser | null;
  scopes: ClientScope[];
  /** Authenticated account (immutable for this login). */
  user_id: string | null;
  /** Account the UI / Core runs as. */
  act_as_user_id: string | null;
  acting_as: ClientActingAs | null;
  loading: boolean;
}

interface AuthActions {
  login: (username: string, password: string) => Promise<string | null>;
  signup: (username: string, email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Enter act-as for target user (site admin). */
  act_as: (target_user_id: string) => Promise<string | null>;
  /** Exit act-as and restore the authenticated account. */
  stop_act_as: () => Promise<string | null>;
}

type AuthContextValue = AuthState & AuthActions;

const AuthContext = createContext<AuthContextValue | null>(null);

const empty_auth_state = (): AuthState => ({
  user: null,
  scopes: [],
  user_id: null,
  act_as_user_id: null,
  acting_as: null,
  loading: false,
});

async function api_post(path: string, body: Record<string, unknown>) {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  return res.json();
}

function apply_session(data: {
  user: ClientUser;
  scopes?: ClientScope[];
  acting_as?: ClientActingAs | null;
  user_id?: string;
  act_as_user_id?: string;
}): AuthState {
  const acting_as = data.acting_as ?? null;
  const act_as_user_id = data.act_as_user_id ?? data.user.id;
  const user_id = data.user_id ?? acting_as?.actor_id ?? data.user.id;
  return {
    user: data.user,
    scopes: data.scopes ?? [],
    user_id,
    act_as_user_id,
    acting_as,
    loading: false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, set_state] = useState<AuthState>({
    ...empty_auth_state(),
    loading: true,
  });

  const hydrate = useCallback(async () => {
    try {
      const data = await api_post('/v1/session/get', {});
      if (data.ok) {
        set_state(apply_session(data.data));
        return;
      }
    } catch {
      /* network error — treat as unauthenticated */
    }
    set_state(empty_auth_state());
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const login = useCallback(async (username: string, password: string): Promise<string | null> => {
    const data = await api_post('/v1/session/create', { username, password });
    if (!data.ok) return data.error?.message || 'Login failed';

    await hydrate();
    return null;
  }, [hydrate]);

  const signup = useCallback(async (
    username: string,
    email: string,
    password: string,
  ): Promise<string | null> => {
    const data = await api_post('/v1/auth/signup', { username, email, password });
    if (!data.ok) return data.error?.message || 'Signup failed';

    await hydrate();
    return null;
  }, [hydrate]);

  const logout = useCallback(async () => {
    try {
      await api_post('/v1/session/delete', {});
    } catch {
      /* best-effort — clear client state regardless */
    }
    set_state(empty_auth_state());
    window.location.href = '/login';
  }, []);

  const refresh = useCallback(async () => {
    await hydrate();
  }, [hydrate]);

  const act_as = useCallback(async (target_user_id: string): Promise<string | null> => {
    const data = await api_post('/v1/session/update', { act_as_user_id: target_user_id });
    if (!data.ok) return data.error?.message || 'Take over failed';
    set_state(apply_session(data.data));
    return null;
  }, []);

  const stop_act_as = useCallback(async (): Promise<string | null> => {
    const data = await api_post('/v1/session/update', { act_as_user_id: null });
    if (!data.ok) return data.error?.message || 'Exit take over failed';
    set_state(apply_session(data.data));
    return null;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, signup, logout, refresh, act_as, stop_act_as }),
    [state, login, signup, logout, refresh, act_as, stop_act_as],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useAuthFetch() {
  const { logout } = useAuth();

  return useCallback(
    async (url: string, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      headers.set('X-Requested-With', 'XMLHttpRequest');

      const res = await fetch(url, {
        ...init,
        method: init?.method || 'POST',
        headers,
        credentials: 'same-origin',
      });

      if (res.status === 401) {
        await logout();
      }

      return res;
    },
    [logout],
  );
}
