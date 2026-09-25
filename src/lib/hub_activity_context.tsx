import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from 'react';
import { useAuth } from '@/lib/auth_context';
import { useOrg, useOrgFetch } from '@/lib/org_context';

interface HubActivity {
	loading: boolean;
	/** No daemons or runs yet — show CLI/daemon onboarding (registry teams alone do not skip this). */
	is_getting_started: boolean;
	/** Default realm slug (bare, e.g. "default"). */
	default_realm_slug: string | null;
	/** Org slug for the default realm (e.g. "elan"). */
	default_org_slug: string | null;
	refresh: () => Promise<void>;
}

const HubActivityContext = createContext<HubActivity | null>(null);

async function list_has_rows(
	auth_fetch: ReturnType<typeof useOrgFetch>,
	path: string,
	body: Record<string, unknown>,
	keys: string[],
): Promise<boolean> {
	const res = await auth_fetch(path, { method: 'POST', body: JSON.stringify(body) });
	const data = await res.json();
	if (!data.ok && data.ok !== undefined) return false;
	for (const key of keys) {
		const value = data[key] ?? data.data?.[key];
		if (typeof value === 'number' && value > 0) return true;
		if (!Array.isArray(value) || value.length === 0) continue;
		if (key === 'scopes') {
			const has_team = value.some(
				(scope: { teams?: unknown[] }) => Array.isArray(scope.teams) && scope.teams.length > 0,
			);
			if (has_team) return true;
			continue;
		}
		return true;
	}
	return false;
}

export function HubActivityProvider({ children }: { children: ReactNode }) {
	const { user } = useAuth();
	const auth_fetch = useOrgFetch();
	const { current_id } = useOrg();
	const [loading, set_loading] = useState(true);
	const [is_getting_started, set_is_getting_started] = useState(true);
	const [default_realm_slug, set_default_realm_slug] = useState<string | null>(null);
	const [default_org_slug, set_default_org_slug] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!user) {
			set_loading(false);
			set_is_getting_started(true);
			set_default_realm_slug(null);
			set_default_org_slug(null);
			return;
		}

		set_loading(true);
		try {
			// Runs probe needs body org_id (RUN-ORG). Without current_id, treat as no runs yet.
			const runs_probe = current_id
				? list_has_rows(auth_fetch, '/v1/runs/get', { org_id: current_id, limit: 1 }, ['runs', 'total'])
				: Promise.resolve(false);
			const [has_daemons, has_runs, session_res] = await Promise.all([
				list_has_rows(auth_fetch, '/v1/daemons/get', { limit: 1 }, ['daemons', 'total']),
				runs_probe,
				auth_fetch('/v1/session/get', {
					method: 'POST',
					body: JSON.stringify({}),
				}).then((r) => r.json()).catch(() => null),
			]);

			// Getting started = runtime not bootstrapped yet. Published registry
			// teams must not hide onboarding (CLI → daemon → first run).
			set_is_getting_started(!has_daemons && !has_runs);

			const slug = session_res?.data?.default_realm_slug
				?? session_res?.default_realm_slug
				?? null;
			set_default_realm_slug(typeof slug === 'string' && slug.trim() ? slug.trim() : null);

			// Extract org slug from the qualified default realm (e.g., "elan.default" → "elan").
			const qualified = session_res?.data?.default_realm_qualified
				?? session_res?.default_realm_qualified
				?? null;
			if (typeof qualified === 'string' && qualified.includes('.')) {
				set_default_org_slug(qualified.slice(0, qualified.indexOf('.')));
			} else {
				set_default_org_slug(null);
			}
		} catch {
			set_is_getting_started(true);
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, current_id, user]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const value = useMemo(
		() => ({ loading, is_getting_started, default_realm_slug, default_org_slug, refresh }),
		[loading, is_getting_started, default_realm_slug, default_org_slug, refresh],
	);

	return (
		<HubActivityContext.Provider value={value}>
			{children}
		</HubActivityContext.Provider>
	);
}

export function useHubActivity(): HubActivity {
	const ctx = useContext(HubActivityContext);
	if (!ctx) {
		return {
			loading: false,
			is_getting_started: false,
			default_realm_slug: null,
			default_org_slug: null,
			refresh: async () => undefined,
		};
	}
	return ctx;
}
