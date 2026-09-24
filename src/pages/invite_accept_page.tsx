import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/lib/auth_context';
import { ApiErrorBanner } from '@/components/ui/api_error';

interface Invite_preview {
	target_type?: 'org' | 'realm';
	email: string;
	role: string;
	org_id: string;
	org_slug: string;
	org_display_name: string;
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

	const [preview, set_preview] = useState<Invite_preview | null>(null);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);
	const [submitting, set_submitting] = useState(false);

	const [username, set_username] = useState('');
	const [password, set_password] = useState('');
	const [display_name, set_display_name] = useState('');

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
				set_preview(data.data);
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
			const res = await fetch('/v1/invitations/accept', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			await refresh();
			// Landing target used to be /organizations — that route
			// still exists as a redirect to /realms, but skipping the
			// hop keeps browser history clean and avoids a flash of
			// the intermediate URL.
			navigate('/realms', { replace: true });
		} catch {
			set_error('Failed to accept invite');
		} finally {
			set_submitting(false);
		}
	}

	async function accept_as_new_user(e: React.FormEvent) {
		e.preventDefault();
		set_submitting(true);
		set_error(null);
		try {
			const res = await fetch('/v1/invitations/accept', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					token,
					username: username.trim().toLowerCase(),
					password,
					display_name: display_name.trim() || undefined,
				}),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			await refresh();
			navigate('/home', { replace: true });
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

	return (
		<div className="mx-auto max-w-md px-6 py-16">
			<h1 className="text-2xl font-extrabold tracking-tight">Join {preview.org_display_name}</h1>
			<p className="mt-2 text-sm text-slate-500">
				You were invited as <span className="font-medium text-slate-700">{preview.email}</span>
				{' '}({preview.role}) to @{preview.org_slug}.
			</p>
			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

			{user && email_matches && (
				<div className="mt-8 space-y-4">
					<p className="text-sm text-slate-600">
						Signed in as @{user.username}. Accept to join this account.
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
				<form onSubmit={(e) => void accept_as_new_user(e)} className="mt-8 space-y-4">
					<p className="text-sm text-slate-600">
						Create your Hub user to join this account. You will not create a separate account.
					</p>
					<label className="block text-xs font-semibold text-slate-600">
						Username
						<input
							required
							value={username}
							onChange={(e) => set_username(e.target.value)}
							className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
							autoComplete="username"
						/>
					</label>
					<label className="block text-xs font-semibold text-slate-600">
						Display name
						<input
							value={display_name}
							onChange={(e) => set_display_name(e.target.value)}
							className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
							autoComplete="name"
						/>
					</label>
					<label className="block text-xs font-semibold text-slate-600">
						Password
						<input
							required
							type="password"
							value={password}
							onChange={(e) => set_password(e.target.value)}
							minLength={8}
							className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
							autoComplete="new-password"
						/>
					</label>
					<button
						type="submit"
						disabled={submitting}
						className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
					>
						{submitting ? 'Creating…' : 'Create user & join'}
					</button>
					<p className="text-center text-xs text-slate-500">
						Already have an account?{' '}
						<Link
							to={`/login?redirect=${encodeURIComponent(`/invite/${token}`)}`}
							className="font-semibold text-indigo-600"
						>
							Log in
						</Link>
					</p>
				</form>
			)}
		</div>
	);
}
