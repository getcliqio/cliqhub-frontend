import { useState } from 'react';
import { useAuth } from '@/lib/auth_context';

/** Persistent yellow ribbon while a site admin is operating as another account. */
export function ImpersonationRibbon() {
	const { user, acting_as, stop_act_as } = useAuth();
	const [busy, set_busy] = useState(false);
	const [error, set_error] = useState('');

	if (!user || !acting_as) return null;

	async function exit_takeover() {
		set_busy(true);
		set_error('');
		const err = await stop_act_as();
		set_busy(false);
		if (err) {
			set_error(err);
			return;
		}
		window.location.href = '/admin/accounts';
	}

	return (
		<div
			role="status"
			className="flex items-center justify-between gap-3 border-b border-amber-400 bg-amber-300 px-4 py-2 text-sm text-amber-950"
		>
			<p className="min-w-0">
				<span className="font-semibold">Admin take over:</span>
				{' '}
				you are @{acting_as.actor_username}, operating as
				{' '}
				<span className="font-semibold">@{user.username}</span>
				{error ? <span className="ml-2 text-red-800">— {error}</span> : null}
			</p>
			<button
				type="button"
				disabled={busy}
				onClick={() => { void exit_takeover(); }}
				className="shrink-0 rounded-md border border-amber-700 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-950 hover:bg-white disabled:opacity-60"
			>
				{busy ? 'Exiting…' : 'Exit take over'}
			</button>
		</div>
	);
}
