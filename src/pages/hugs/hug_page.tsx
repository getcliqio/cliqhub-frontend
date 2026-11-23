/**
 * Hug — /hugs/:hug_id. Every Hug is asked and answered in getHugs (PLAN-gethugs-step8-cutover.md): this page reads
 * the Hug (`POST /v1/hugs/get_by_id`; Core lets in anyone with runs.view on its realm) and opens its getHugs page,
 * signed in (PLAN-gethugs-step7-sign-in.md).
 */
import { useEffect } from 'react';
import { useParams } from 'react-router';
import { useAuthFetch } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { gethugs_open_url, type Hug } from '@/lib/hug';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

export function Component() {
	const { hug_id = '' } = useParams();
	const overview = use_overview();
	const read = use_bff_read<Hug>('/v1/hugs/get_by_id', hug_id ? { hug_id } : null, { fallback_error: 'Could not load this Hug.' });
	const h = read.data ?? null;
	const target = h?.hug_url ?? null;
	const open_fetch = useAuthFetch();
	useEffect(() => {
		if (!target || !h) return;
		void gethugs_open_url(open_fetch, { hug_id: h.id }, target).then((url) => window.location.replace(url));
	// Once per Hug: the link signs in once.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [target]);

	return (
		<Graphite_shell data={overview.data} title="Hug">
			{target ? (
				<p className="px-7 py-6 text-[13px] text-[var(--g-ink-3)]" data-testid="hug-elsewhere">Opening this Hug in getHugs… <a href={target} className="underline">Open it</a></p>
			) : (
				<div className="px-7 py-6">
					{read.status === 'error'
						? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="Hug" />
						: <div className="h-[120px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" />}
				</div>
			)}
		</Graphite_shell>
	);
}
