/**
 * HUGs — /hugs. What's waiting on a person is in getHugs (PLAN-gethugs-step6-ui-link.md): shown here, inside CliqHub's
 * page, for the org in view (getHugs' embed, signed in by a statement; PLAN-gethugs-partner-ux.md §4).
 */
import { useAuth } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { use_view_scope } from '@/lib/view_scope';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Gethugs_frame } from '@/components/hug/gethugs_frame';

export function Component() {
	const { gethugs_app_url } = useAuth();
	const inbox = gethugs_app_url ? `${gethugs_app_url}/hugs` : null;
	const overview = use_overview();
	const scope = use_view_scope(overview.data);
	const org_id = scope.kind === 'realm' ? scope.realm.org_id : scope.org?.id ?? null;
	const settled = overview.data !== null || overview.status === 'error';

	return (
		<Graphite_shell data={overview.data} title="HUGs">
			{settled && org_id && inbox ? (
				<Gethugs_frame target={{ org_id }} open_url={inbox} />
			) : settled ? (
				<p className="px-7 py-6 text-[13px] text-[var(--g-ink-3)]" data-testid="hugs-elsewhere">
					Your HUGs are in getHugs.{inbox ? <> <a href={inbox} target="_blank" rel="noopener noreferrer" className="underline">Open them</a></> : null}
				</p>
			) : (
				<div className="px-7 py-6"><div className="h-[120px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" /></div>
			)}
		</Graphite_shell>
	);
}
