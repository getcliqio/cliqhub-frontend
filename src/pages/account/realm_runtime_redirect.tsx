import { Navigate, useParams, useLocation } from 'react-router';
import { useHubActivity } from '@/lib/hub_activity_context';
import { realm_sub_path } from '@/lib/realm_url';

/**
 * Send root /runs|/daemons|/logs (and optional :run_id) to the caller's default realm.
 */
export function Realm_runtime_redirect({
	section,
}: {
	section: 'runs' | 'daemons' | 'logs';
}) {
	const { default_realm_slug, default_org_slug, loading } = useHubActivity();
	const { run_id } = useParams();
	const location = useLocation();

	if (loading) {
		return <p className="text-sm text-slate-400">Loading…</p>;
	}

	if (!default_realm_slug || !default_org_slug) {
		return <Navigate to="/realms" replace />;
	}

	const base = realm_sub_path(default_org_slug, default_realm_slug, section);
	const suffix = section === 'runs' && run_id ? `/${run_id}` : '';
	return <Navigate to={`${base}${suffix}${location.search}`} replace />;
}
