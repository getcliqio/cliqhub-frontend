import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { account_error_message } from '@/lib/account';

export interface ClientUser {
  id: string;
  username: string;
  display_name: string;
  email: string;
  role: 'user' | 'admin';
  preferences: Record<string, unknown>;
}

export interface ClientScope {
  id: string;
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
  /** A request got 401: re-check the session; go to /login only if it is really gone. */
  on_unauthorized: () => Promise<void>;
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

/** What `session/get` said: a session, definitely none (401), or no answer (BFF down / 5xx). */
type SessionCheck =
  | { kind: 'signed_in'; data: Parameters<typeof apply_session>[0] }
  | { kind: 'signed_out' }
  | { kind: 'unavailable' };

/** First-load retry while the BFF is unavailable: 1s, 2s, 4s … capped at 10s. */
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 10_000;

/** The 401 re-check in flight, shared by concurrent 401s. */
let unauthorized_check: Promise<SessionCheck> | null = null;

/** Asks the BFF who is signed in; never throws. */
async function read_session(): Promise<SessionCheck> {
  try {
    const res = await fetch('/v1/session/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
      body: '{}',
    });
    if (res.status === 401) return { kind: 'signed_out' };
    if (!res.ok) return { kind: 'unavailable' };
    const body = await res.json();
    return body?.ok && body.data?.user ? { kind: 'signed_in', data: body.data } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
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

  /**
   * Reads the session and applies it. Only a definite answer changes who is
   * signed in: `signed_out` (HTTP 401) clears the state. When the BFF can't be
   * reached (restarting, 5xx, network) the current state is kept — and on the
   * first load we stay in `loading` and retry — so a BFF restart never looks
   * like a sign-out.
   */
  const hydrate = useCallback(async (): Promise<SessionCheck> => {
    const check = await read_session();
    if (check.kind === 'signed_in') set_state(apply_session(check.data));
    else if (check.kind === 'signed_out') set_state(empty_auth_state());
    return check;
  }, []);

  useEffect(() => {
    // First load: retry while the BFF is unavailable (capped backoff) instead
    // of showing the sign-in page for a session that is still valid.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async (delay_ms: number) => {
      const check = await hydrate();
      if (cancelled || check.kind !== 'unavailable') return;
      timer = setTimeout(() => void attempt(Math.min(delay_ms * 2, MAX_RETRY_MS)), delay_ms);
    };
    void attempt(FIRST_RETRY_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hydrate]);

  const login = useCallback(async (username: string, password: string): Promise<string | null> => {
    const data = await api_post('/v1/session/create', { username, password });
    if (!data.ok) return account_error_message(data.error, 'Login failed');

    await hydrate();
    return null;
  }, [hydrate]);

  const signup = useCallback(async (
    username: string,
    email: string,
    password: string,
  ): Promise<string | null> => {
    const data = await api_post('/v1/auth/signup', { username, email, password });
    if (!data.ok) return account_error_message(data.error, 'Signup failed');

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

  /**
   * A request answered 401. Re-check the session (one check at a time) and
   * only sign out on the client when the BFF confirms there is no session —
   * a 401 from one Core call, or one during a restart, must not end a valid
   * session. Never calls session/delete: that is the explicit "Sign out".
   */
  const on_unauthorized = useCallback(async () => {
    unauthorized_check ??= hydrate().finally(() => { unauthorized_check = null; });
    const check = await unauthorized_check;
    if (check.kind === 'signed_out') window.location.href = '/login';
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
    () => ({ ...state, login, signup, logout, refresh, act_as, stop_act_as, on_unauthorized }),
    [state, login, signup, logout, refresh, act_as, stop_act_as, on_unauthorized],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * `fetch` for BFF calls from components: JSON + CSRF headers, cookie
 * credentials; a 401 triggers a session re-check (see `on_unauthorized`).
 */
export function useAuthFetch() {
  const { on_unauthorized } = useAuth();

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
        await on_unauthorized();
      }

      return res;
    },
    [on_unauthorized],
  );
}
