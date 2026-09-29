/**
 * Organization context — tracks which org the user is operating in.
 *
 * The active org is available via `useOrg()`. Endpoints that need an org
 * accept `org_id` in the request body; callers should pass `current_id`
 * from `useOrg()` explicitly.
 * Solo users (single org) never see org-switching UI.
 * The personal org (slug === username) is the default.
 */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import { useAuth, useAuthFetch as useRawAuthFetch, type ClientUser } from '@/lib/auth_context';

const STORAGE_KEY = 'cliqhub_current_org_id';

export interface OrgInfo {
    id: string;
    slug: string;
    display_name: string;
}

interface OrgContextValue {
    /** Currently active org (null while loading or when unauthenticated). */
    current_org: OrgInfo | null;
    /**
     * Currently active org id — resolvable synchronously from localStorage on
     * first paint, before the org list finishes loading. Pass this as `org_id`
     * in request bodies that require org tenancy.
     */
    current_id: string | null;
    /** All orgs the user belongs to. */
    orgs: OrgInfo[];
    /** True when orgs are still loading. */
    loading: boolean;
    /** Whether user belongs to more than one org. */
    is_multi_org: boolean;
    /** Whether the active org is the user's personal org. */
    is_personal: boolean;
    /** Switch to a different org. */
    switch_org: (org_id: string) => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
    const { user, loading: auth_loading } = useAuth();
    const raw_fetch = useRawAuthFetch();
    const [orgs, set_orgs] = useState<OrgInfo[]>([]);
    const [current_id, set_current_id] = useState<string | null>(() => {
        try {
            const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
            return stored || null;
        } catch {
            return null;
        }
    });
    const [loading, set_loading] = useState(true);

    /** Fetch org list when user is available. */
    useEffect(() => {
        if (auth_loading) return;
        if (!user) {
            set_orgs([]);
            set_current_id(null);
            set_loading(false);
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const res = await raw_fetch('/v1/orgs/get', {
                    method: 'POST',
                    body: JSON.stringify({ mine: true }),
                });
                const json = await res.json();
                if (cancelled) return;
                if (json.ok) {
                    const list: OrgInfo[] = (json.data?.orgs ?? []).map((o: any) => ({
                        id: String(o.id),
                        slug: o.slug,
                        display_name: o.display_name ?? o.slug,
                    }));
                    set_orgs(list);
                    resolve_default(list, user, current_id, set_current_id);
                }
            } catch {
                /* network failure — stay with whatever we have */
            }
            if (!cancelled) set_loading(false);
        })();

        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [auth_loading, user?.id]);

    const switch_org = useCallback((org_id: string) => {
        set_current_id(org_id);
        try { globalThis.localStorage?.setItem(STORAGE_KEY, String(org_id)); } catch { /* SSR/test */ }
    }, []);

    const value = useMemo<OrgContextValue>(() => {
        const current_org = orgs.find(o => o.id === current_id) ?? null;
        return {
            current_org,
            current_id,
            orgs,
            loading,
            is_multi_org: orgs.length > 1,
            is_personal: current_org ? current_org.slug === user?.username : true,
            switch_org,
        };
    }, [orgs, current_id, loading, user?.username, switch_org]);

    return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgContextValue {
    const ctx = useContext(OrgContext);
    if (!ctx) throw new Error('useOrg must be used within OrgProvider');
    return ctx;
}

/**
 * Authenticated fetch with org context available via `useOrg()`.
 * Drop-in replacement for useAuthFetch when the current org id is needed.
 *
 * Callers are responsible for including `org_id` in their request bodies.
 * The legacy `X-Org-Id` header is no longer sent — org tenancy is explicit
 * in every endpoint's request body.
 */
export function useOrgFetch() {
    const raw_fetch = useRawAuthFetch();

    return useCallback(
        async (url: string, init?: RequestInit): Promise<Response> => {
            return raw_fetch(url, init);
        },
        [raw_fetch],
    );
}

/** Pick the right default org on initial load. */
function resolve_default(
    orgs: OrgInfo[],
    user: ClientUser,
    stored_id: string | null,
    set_id: (id: string) => void,
) {
    if (orgs.length === 0) return;

    // If stored id is still valid, keep it.
    if (stored_id && orgs.some(o => o.id === stored_id)) return;

    // Default to personal org (slug === username).
    const personal = orgs.find(o => o.slug === user.username);
    if (personal) {
        set_id(personal.id);
        try { globalThis.localStorage?.setItem(STORAGE_KEY, personal.id); } catch { /* SSR/test */ }
        return;
    }

    // Fallback: first org.
    set_id(orgs[0].id);
    try { globalThis.localStorage?.setItem(STORAGE_KEY, orgs[0].id); } catch { /* SSR/test */ }
}
