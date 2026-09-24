import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth} from '@/lib/auth_context';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { realm_qualified_label } from '@/lib/realm_url';

interface Invite_preview {
	target_type?: 'org' | 'realm';
	email: string;
	role: string;
	realm_id: string;
	realm_slug: string;
	realm_name: string;
	expires_at: string;
}

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

export function Component() {
	const { token = '' } = useParams();
	const navigate = useNavigate();
	const { user, loading: auth_loading, refresh } = useAuth();
	const auth_fetch = useOrgFetch();

	const [preview, set_preview] = useState<Invite_preview | null>(null);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);
	const [submitting, set_submitting] = useState(false);

	useEffect(() => {
		async function load_preview() {
			set_loading(true);
			set_error(null);
			try {
				const res = await fetch('/v1/invitations/get_by_token', {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ token }),
				});
				const data = await res.json();
				if (!data.ok) {
					set_error(api_error_message(data));
					set_preview(null);
					return;
				}
				const row = data.data ?? {};
				set_preview({
					target_type: row.target_type,
					email: row.email,
					role: row.role,
					realm_id: row.realm_id,
					realm_slug: row.realm_slug,
					realm_name: row.realm_name,
					expires_at: row.expires_at,
				});
			} catch {
				set_error('Network error');
			} finally {
				set_loading(false);
			}
		}
		if (token) void load_preview();
	}, [token]);

	async function accept_as_signed_in() {
		set_submitting(true);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/invitations/accept', {
				method: 'POST',
				body: JSON.stringify({ token }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			await refresh();
			const accepted_slug = data.data?.realm_slug ?? preview?.realm_slug ?? '';
			const realm_id = data.data?.realm_id ?? preview?.realm_id;
			let accepted_org = 'unknown';
			if (realm_id) {
				try {
					const realm_res = await auth_fetch('/v1/realms/get_by_id', {
						method: 'POST',
						body: JSON.stringify({ realm_id }),
					});
					const realm_data = await realm_res.json();
					if (realm_data.ok && realm_data.realm?.org_slug) {
						accepted_org = realm_data.realm.org_slug;
					}
				} catch {
					/* fall through with unknown */
				}
			}
			navigate(`/o/${accepted_org}/realms/${accepted_slug}`, { replace: true });
		} catch {
			set_error('Failed to accept invite');
		} finally {
			set_submitting(false);
		}
	}

	if (loading || auth_loading) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<p className="text-sm text-slate-400">Loading invite…</p>
			</div>
		);
	}

	if (!preview) {
		return (
			<div className="mx-auto max-w-md px-6 py-16 text-center">
				<h1 className="text-xl font-bold">Invite unavailable</h1>
				<p className="mt-2 text-sm text-slate-500">{error ?? 'This invite is invalid or expired.'}</p>
				<Link to="/login" className="mt-6 inline-block text-sm font-semibold text-indigo-600">
					Go to login
				</Link>
			</div>
		);
	}

	const email_matches = Boolean(
		user?.email && user.email.trim().toLowerCase() === preview.email.toLowerCase(),
	);
	const realm_label = realm_qualified_label(null, preview.realm_slug);

	return (
		<div className="mx-auto max-w-md px-6 py-16">
			<h1 className="text-2xl font-extrabold tracking-tight">Join {preview.realm_name || realm_label}</h1>
			<p className="mt-2 text-sm text-slate-500">
				You were invited as <span className="font-medium text-slate-700">{preview.email}</span>
				{' '}({preview.role}) to realm <span className="font-mono text-slate-700">{realm_label}</span>.
			</p>
			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

			{user && email_matches && (
				<div className="mt-8 space-y-4">
					<p className="text-sm text-slate-600">
						Signed in as @{user.username}. Accept to join this realm.
					</p>
					<button
						type="button"
						disabled={submitting}
						onClick={() => void accept_as_signed_in()}
						className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
					>
						{submitting ? 'Joining…' : 'Accept invite'}
					</button>
				</div>
			)}

			{user && !email_matches && (
				<div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
					You are signed in as {user.email}, but this invite is for {preview.email}.
					{' '}
					<Link to="/login" className="font-semibold underline">
						Sign in with the invited email
					</Link>
					{' '}or open this link while logged out.
				</div>
			)}

			{!user && (
				<div className="mt-8 space-y-4">
					<p className="text-sm text-slate-600">
						Create a Hub account (or log in) with {preview.email}, then open this link again to join the realm.
					</p>
					<Link
						to={`/signup?redirect=${encodeURIComponent(`/realm-invite/${token}`)}`}
						className="block w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-indigo-700"
					>
						Create account
					</Link>
					<p className="text-center text-xs text-slate-500">
						Already have an account?{' '}
						<Link
							to={`/login?redirect=${encodeURIComponent(`/realm-invite/${token}`)}`}
							className="font-semibold text-indigo-600"
						>
							Log in
						</Link>
					</p>
				</div>
			)}
		</div>
	);
}
