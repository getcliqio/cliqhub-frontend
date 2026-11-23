/**
 * HUGs — /hugs. What's waiting on a person is in getHugs (PLAN-gethugs-step6-ui-link.md): this page opens getHugs'
 * inbox, signed in to the org in view (PLAN-gethugs-step7-sign-in.md).
 */
import { useEffect } from 'react';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { gethugs_open_url } from '@/lib/hug';
import { use_overview } from '@/lib/overview';
import { use_view_scope } from '@/lib/view_scope';
import { Graphite_shell } from '@/components/graphite/graphite_shell';

export function Component() {
	const { gethugs_app_url } = useAuth();
	const inbox = gethugs_app_url ? `${gethugs_app_url}/hugs` : null;
	const open_fetch = useAuthFetch();
	const overview = use_overview();
	const scope = use_view_scope(overview.data);
	const org_id = scope.kind === 'realm' ? scope.realm.org_id : scope.org?.id ?? null;
	const settled = overview.data !== null || overview.status === 'error';
	useEffect(() => {
		if (!inbox || !settled) return;
		void (org_id ? gethugs_open_url(open_fetch, { org_id }, inbox) : Promise.resolve(inbox)).then((url) => window.location.replace(url));
	// Once the org in view is known: the link signs in once.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [inbox, settled]);

	return (
		<Graphite_shell data={overview.data} title="HUGs">
			<p className="px-7 py-6 text-[13px] text-[var(--g-ink-3)]" data-testid="hugs-elsewhere">
				Opening your HUGs in getHugs…{inbox ? <> <a href={inbox} className="underline">Open them</a></> : null}
			</p>
		</Graphite_shell>
	);
}
