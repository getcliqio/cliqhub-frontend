/**
 * The answer to a `409 deleted` from a create route (orgs/new, invitations/create,
 * users/new): the name belongs to a soft-deleted org or account. A site admin
 * is asked "Reactivate?" and the caller resends the same request with
 * `reactivate: true`; anyone else is told to contact their admin.
 */
import { RotateCcw } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { month_year, type Deleted_details } from '@/lib/admin';
import { G_BTN, G_PRIMARY } from '@/components/graphite/g_agents';

/** Shows the deleted-name prompt; `on_reactivate` resends the original request with `reactivate: true`. */
export function Deleted_notice({ name, details, busy = false, on_reactivate, on_cancel }: {
	/** The name that was refused (slug, username or email). */
	name: string;
	details: Deleted_details | null;
	busy?: boolean;
	on_reactivate: () => void;
	on_cancel: () => void;
}) {
	const { user } = useAuth();
	const what = details?.kind === 'org' ? 'a deleted organization' : 'a deleted account';
	const when = details?.deleted_at ? ` (deleted ${month_year(details.deleted_at)})` : '';
	if (user?.role !== 'admin') {
		return (
			<div role="alert" data-testid="deleted-notice" className="w-full rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] px-3.5 py-2.5 text-[12.5px]">
				<b>{name}</b> belongs to {what}. Contact your admin.
			</div>
		);
	}
	return (
		<div role="alertdialog" aria-label="Reactivate?" data-testid="deleted-notice" className="flex w-full flex-wrap items-center gap-3 rounded-[10px] border border-[rgba(255,178,36,.4)] bg-[var(--g-warn-soft)] px-3.5 py-2.5 text-[12.5px]">
			<p className="min-w-0 flex-1"><b>{name}</b> belongs to {what}{when}. Reactivate it? It comes back with the same id and history.</p>
			<button type="button" disabled={busy} onClick={on_reactivate} className={G_PRIMARY}><RotateCcw aria-hidden className="h-3.5 w-3.5" /> Reactivate</button>
			<button type="button" onClick={on_cancel} className={G_BTN}>Cancel</button>
		</div>
	);
}
