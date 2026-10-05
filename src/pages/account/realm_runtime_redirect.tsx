import { useEffect, useState } from 'react';
import { Navigate, useParams, useLocation } from 'react-router';
import { useAuthFetch } from '@/lib/auth_context';
import { realm_sub_path } from '@/lib/realm_url';

type Default_realm = { org_slug: string; realm_slug: string } | null;

/** The caller's default realm from `/v1/session/get` (`default_realm_qualified` = `org.realm`). */
function use_default_realm(): { loading: boolean; realm: Default_realm } {
	const auth_fetch = useAuthFetch();
	const [state, set_state] = useState<{ loading: boolean; realm: Default_realm }>({ loading: true, realm: null });
	useEffect(() => {
		let live = true;
		void auth_fetch('/v1/session/get', { method: 'POST', body: JSON.stringify({}) })
			.then((r) => r.json())
			.catch(() => null)
			.then((p: { data?: Record<string, unknown> } & Record<string, unknown> | null) => {
				if (!live) return;
				const qualified = p?.data?.default_realm_qualified ?? p?.default_realm_qualified;
				const dot = typeof qualified === 'string' ? qualified.indexOf('.') : -1;
				set_state({
					loading: false,
					realm: dot > 0 ? { org_slug: (qualified as string).slice(0, dot), realm_slug: (qualified as string).slice(dot + 1) } : null,
				});
			});
		return () => { live = false; };
	}, [auth_fetch]);
	return state;
}

/**
 * Send root /runs|/daemons|/logs (and optional :run_id) to the caller's default realm.
 */
export function Realm_runtime_redirect({
	section,
}: {
	section: 'runs' | 'daemons' | 'logs';
}) {
	const { loading, realm } = use_default_realm();
	const { run_id } = useParams();
	const location = useLocation();

	if (loading) {
		return <p className="text-sm text-slate-400">Loading…</p>;
	}

	if (!realm) {
		return <Navigate to="/realms" replace />;
	}

	const base = realm_sub_path(realm.org_slug, realm.realm_slug, section);
	const suffix = section === 'runs' && run_id ? `/${run_id}` : '';
	return <Navigate to={`${base}${suffix}${location.search}`} replace />;
}
