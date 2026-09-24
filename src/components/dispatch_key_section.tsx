import { useCallback, useEffect, useState } from 'react';
import { useOrgFetch } from '@/lib/org_context';
import { CopyButton } from '@/components/copy_button';

interface DispatchKeySectionProps {
	realm_id: string;
	is_admin: boolean;
}

interface DispatchKeyData {
	realm_id: string;
	public_key_pem: string;
	created_at: number | null;
	rotated_at: number | null;
}

export function DispatchKeySection({ realm_id, is_admin }: DispatchKeySectionProps) {
	const auth_fetch = useOrgFetch();
	const [key_data, set_key_data] = useState<DispatchKeyData | null>(null);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState('');
	const [regenerating, set_regenerating] = useState(false);
	const [confirm_regen, set_confirm_regen] = useState(false);

	const load = useCallback(async () => {
		set_loading(true);
		set_error('');
		try {
			const res = await auth_fetch('/v1/auth/get_dispatch_public_key', {
				method: 'POST',
				body: JSON.stringify({ realm_id }),
			});
			const data = await res.json();
			if (data.ok) {
				set_key_data(data.data ?? data);
				set_loading(false);
				return;
			}
			set_error(data.error?.message || 'Failed to load dispatch public key');
		} catch {
			set_error('Network error loading dispatch key');
		}
		set_loading(false);
	}, [auth_fetch, realm_id]);

	useEffect(() => {
		load();
	}, [load]);

	async function handle_regenerate() {
		if (!confirm_regen) {
			set_confirm_regen(true);
			return;
		}

		set_regenerating(true);
		set_error('');
		try {
			const res = await auth_fetch('/v1/auth/rotate_dispatch_key', {
				method: 'POST',
				body: JSON.stringify({ realm_id }),
			});
			const data = await res.json();
			if (data.ok) {
				set_key_data(data.data ?? data);
				set_confirm_regen(false);
				set_regenerating(false);
				return;
			}
			set_error(data.error?.message || 'Failed to regenerate key');
		} catch {
			set_error('Network error regenerating key');
		}
		set_regenerating(false);
	}

	return (
		<section className="mb-10">
			<div className="mb-4 flex items-center justify-between">
				<h2 className="text-lg font-bold text-slate-700">Daemon public key</h2>
				{is_admin && (
					<button
						type="button"
						onClick={handle_regenerate}
						disabled={regenerating || loading}
						className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
					>
						{confirm_regen ? (regenerating ? 'Rotating…' : 'Confirm rotate') : 'Rotate'}
					</button>
				)}
			</div>
			<p className="mb-3 text-xs text-slate-500">
				Realm-scoped PEM for{' '}
				<code className="rounded bg-slate-100 px-1">CLIQ_DISPATCH_PUBLIC_KEY</code>. Fetch with{' '}
				<code className="rounded bg-slate-100 px-1">cliq auth daemon-key --realm …</code>.
			</p>
			{error && <p className="mb-2 text-sm text-red-600">{error}</p>}
			{loading ? (
				<p className="text-sm text-slate-400">Loading…</p>
			) : key_data?.public_key_pem ? (
				<div className="rounded-xl border border-slate-200 bg-white p-4">
					<pre className="mb-2 overflow-x-auto whitespace-pre-wrap break-all text-xs text-slate-700">
						{key_data.public_key_pem}
					</pre>
					<CopyButton text={key_data.public_key_pem} />
				</div>
			) : (
				<p className="text-sm text-slate-400">No key yet.</p>
			)}
		</section>
	);
}
