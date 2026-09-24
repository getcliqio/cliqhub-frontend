import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useOrgFetch } from '@/lib/org_context';

const REALM_DETAIL_STORAGE_KEY = 'cliq.realm_detail_id';

function resolve_realm_id(state: unknown): string {
	const from_state = (state as { realm_id?: string } | null)?.realm_id?.trim();
	if (from_state) return from_state;
	try {
		return sessionStorage.getItem(REALM_DETAIL_STORAGE_KEY)?.trim() ?? '';
	} catch {
		return '';
	}
}

/** Legacy `/account/realms/get_by_id` → `/realms/:slug`. */
export function Component() {
	const location = useLocation();
	const auth_fetch = useOrgFetch();
	const realm_id = resolve_realm_id(location.state);
	const [slug, set_slug] = useState<string | null>(null);
	const [org_slug, set_org_slug] = useState<string | null>(null);
	const [failed, set_failed] = useState(false);

	useEffect(() => {
		if (!realm_id) {
			set_failed(true);
			return;
		}

		let cancelled = false;
		(async () => {
			try {
				const res = await auth_fetch('/v1/realms/get_by_id', {
					method: 'POST',
					body: JSON.stringify({ realm_id }),
				});
				const data = await res.json();
				if (cancelled) return;
				if (data.ok && data.realm?.slug) {
					set_slug(data.realm.slug);
					set_org_slug(data.realm.org_slug ?? null);
					return;
				}
				set_failed(true);
			} catch {
				if (!cancelled) set_failed(true);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [auth_fetch, realm_id]);

	if (slug) return <Navigate to={`/o/${org_slug ?? 'unknown'}/realms/${slug}`} replace />;

	if (failed) {
		return (
			<div>
				<p className="text-sm text-slate-500">Could not resolve that realm.</p>
				<Link to="/realms" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
					← Realms
				</Link>
			</div>
		);
	}

	return (
		<div className="flex min-h-[40vh] items-center justify-center">
			<p className="text-sm text-slate-400">Redirecting…</p>
		</div>
	);
}
