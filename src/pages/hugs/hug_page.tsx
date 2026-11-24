/**
 * Hug — /hugs/:hug_id. Every Hug is asked and answered in getHugs (PLAN-gethugs-step8-cutover.md): this page reads
 * the Hug (`POST /v1/hugs/get_by_id`; Core lets in anyone with runs.view on its realm) and shows its getHugs page inside
 * CliqHub's (getHugs' embed, signed in by a statement; PLAN-gethugs-partner-ux.md §4).
 */
import { useParams } from 'react-router';
import { use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { type Hug } from '@/lib/hug';
import { Gethugs_frame } from '@/components/hug/gethugs_frame';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

export function Component() {
	const { hug_id = '' } = useParams();
	const overview = use_overview();
	const read = use_bff_read<Hug>('/v1/hugs/get_by_id', hug_id ? { hug_id } : null, { fallback_error: 'Could not load this Hug.' });
	const h = read.data ?? null;
	const target = h?.hug_url ?? null;

	return (
		<Graphite_shell data={overview.data} title="Hug">
			{h && target ? (
				<Gethugs_frame target={{ hug_id: h.id }} open_url={target} />
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
