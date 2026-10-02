/**
 * Accept or decline an invitation (Graphite) — /invite/:token (also served at /realm-invite/:token).
 * BFF routes (public): invitations/get_by_token (preview) · invitations/accept { decision }.
 *   pending, signed in as the invited email   → Accept / Decline;
 *   pending, signed in as someone else        → explains which address the invite is for;
 *   pending, signed out, account exists       → sign in, then come back here;
 *   pending, signed out, no account           → username, display name, password → account + accept, then
 *                                               says which username the account has (a reactivated account keeps its own);
 *   expired / revoked / accepted / declined   → says what happened; an unknown token says the link isn't valid.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/lib/auth_context';
import { account_error_message, PASSWORD_MIN } from '@/lib/account';
import { day_month, role_label, type Invite_accept_data, type Invite_preview, type Invite_status } from '@/lib/invites';
import { public_post } from '@/lib/public_post';
import { AUTH_INPUT, AUTH_PRIMARY, AUTH_SECONDARY, Auth_error, Auth_shell } from '@/components/graphite/g_auth';

const USERNAME_RE = /^[a-z][a-z0-9-]*$/;

function target_name(p: Invite_preview): string {
	if (p.kind === 'realm') return p.realm?.display_name || p.realm?.slug || 'a realm';
	return p.org.display_name || p.org.slug;
}

/** What a used or dead invite says, keyed by its status. */
function closed_text(status: Exclude<Invite_status, 'pending'>, inviter: string): { title: string; body: string } {
	if (status === 'expired') return { title: 'This invite has expired', body: `Ask ${inviter} to send it again.` };
	if (status === 'revoked') return { title: 'This invite is no longer valid', body: `Ask ${inviter} for a new one.` };
	if (status === 'declined') return { title: 'This invite was declined', body: `If that was a mistake, ask ${inviter} to send it again.` };
	return { title: 'This invite was already accepted', body: 'Sign in to CliqHub to continue.' };
}

type View =
	| { kind: 'loading' }
	| { kind: 'unknown' }
	| { kind: 'ready'; preview: Invite_preview }
	| { kind: 'declined'; preview: Invite_preview }
	| { kind: 'joined'; preview: Invite_preview; username: string; next: string };

export function Component() {
	const { token = '' } = useParams();
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const { user, loading: auth_loading, refresh } = useAuth();
	const [view, set_view] = useState<View>({ kind: 'loading' });
	const [error, set_error] = useState<string | null>(null);
	const [username_error, set_username_error] = useState<string | null>(null);
	const [busy, set_busy] = useState(false);
	const [f, set_f] = useState({ username: '', display_name: '', password: '' });

	useEffect(() => {
		let off = false;
		void public_post<Invite_preview>('/v1/invitations/get_by_token', { token }, 'Could not load the invitation.').then((r) => {
			if (off) return;
			if (r.ok) set_view({ kind: 'ready', preview: r.data });
			else if (r.code === 'not_found' || r.status === 404) set_view({ kind: 'unknown' });
			else { set_error(r.error); set_view({ kind: 'unknown' }); }
		});
		return () => { off = true; };
	}, [token]);

	if (view.kind === 'loading' || auth_loading) return <Auth_shell><p role="status" className="text-[13px] text-[var(--g-ink-3)]">Loading invitation…</p></Auth_shell>;
	if (view.kind === 'unknown') {
		return (
			<Auth_shell>
				<h1 className="text-[24px] font-semibold tracking-[-0.02em]">This invite link isn’t valid</h1>
				<p className="mt-2 text-[14px] text-[var(--g-ink-3)]">{error ?? 'Check the link in your email, or ask whoever invited you for a new one.'}</p>
				<Link to={user ? '/home' : '/login'} className={`${AUTH_SECONDARY} mt-7`}>{user ? 'Go to CliqHub' : 'Sign in'}</Link>
			</Auth_shell>
		);
	}

	const preview = view.preview;
	const name = target_name(preview);
	const inviter = preview.inviter?.display_name || 'whoever invited you';
	const here = pathname;

	if (view.kind === 'declined') {
		return (
			<Auth_shell>
				<h1 className="text-[24px] font-semibold tracking-[-0.02em]">Invite declined</h1>
				<p className="mt-2 text-[14px] text-[var(--g-ink-3)]">You won’t join {name}. {preview.inviter ? `${preview.inviter.display_name} has been told.` : ''}</p>
				<Link to={user ? '/home' : '/login'} className={`${AUTH_SECONDARY} mt-7`}>{user ? 'Go to CliqHub' : 'Sign in'}</Link>
			</Auth_shell>
		);
	}
	if (view.kind === 'joined') {
		return (
			<Auth_shell>
				<h1 className="text-[24px] font-semibold tracking-[-0.02em]">You’re in</h1>
				<p className="mt-2 text-[14px] text-[var(--g-ink-3)]" data-testid="joined">You joined {name}. Your username is <b className="text-[var(--g-ink)]">@{view.username}</b>; sign in with it or your email.</p>
				<Link to={view.next} replace className={`${AUTH_PRIMARY} mt-7`}>Continue</Link>
			</Auth_shell>
		);
	}
	if (preview.status !== 'pending') {
		const t = closed_text(preview.status, inviter);
		return (
			<Auth_shell>
				<h1 className="text-[24px] font-semibold tracking-[-0.02em]">{t.title}</h1>
				<p className="mt-2 text-[14px] text-[var(--g-ink-3)]">{t.body}</p>
				<Link to={user ? '/home' : '/login'} className={`${AUTH_SECONDARY} mt-7`}>{user ? 'Go to CliqHub' : 'Sign in'}</Link>
			</Auth_shell>
		);
	}

	const email_ok = Boolean(user?.email && user.email.trim().toLowerCase() === preview.invitee_email.trim().toLowerCase());

	async function answer(decision: 'accept' | 'decline', extra: Record<string, unknown> = {}) {
		set_busy(true); set_error(null); set_username_error(null);
		const r = await public_post<Invite_accept_data>('/v1/invitations/accept', { token, decision, ...extra }, 'Could not answer the invitation.');
		set_busy(false);
		if (!r.ok) {
			if (r.code === 'expired') { set_view({ kind: 'ready', preview: { ...preview, status: 'expired' } }); return; }
			if (r.code === 'not_pending') { set_view({ kind: 'ready', preview: { ...preview, status: (r.details?.status as Invite_status | undefined) ?? 'accepted' } }); return; }
			if (r.code === 'conflict' && extra.username) { set_username_error(r.error); return; }
			if (r.code === 'sign_in_required') { set_error(`Sign in as ${preview.invitee_email} to answer this invite.`); return; }
			if (r.code === 'email_mismatch') { set_error(`This invite is for ${preview.invitee_email}. Sign out and sign in with that address.`); return; }
			set_error(account_error_message({ code: r.code, message: r.error }, r.error));
			return;
		}
		if (r.data.decision === 'decline') { set_view({ kind: 'declined', preview }); return; }
		await refresh();
		const realm_slug = r.data.realm?.slug;
		const next = preview.kind === 'realm' ? `/realms${realm_slug ? `?joined=${encodeURIComponent(realm_slug)}` : ''}` : '/home';
		if (r.data.user.created) set_view({ kind: 'joined', preview, username: r.data.user.username, next });
		else navigate(next, { replace: true });
	}
	function create(e: FormEvent) {
		e.preventDefault();
		void answer('accept', { username: f.username.trim().toLowerCase(), password: f.password, ...(f.display_name.trim() ? { display_name: f.display_name.trim() } : {}) });
	}

	const uname_bad = f.username.length > 0 && !USERNAME_RE.test(f.username.trim().toLowerCase());
	const heading = preview.kind === 'owner' ? `You’re invited to own ${name}` : `You’re invited to join ${name}`;
	const decline = <button type="button" disabled={busy} onClick={() => void answer('decline')} className={AUTH_SECONDARY}>Decline</button>;
	return (
		<Auth_shell>
			<div className="mb-7 rounded-xl border border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] px-4 py-3 text-[13px]" data-testid="invite-summary">
				<h1 className="text-[18px] font-semibold tracking-[-0.01em]">{heading}</h1>
				<p className="mt-1 text-[12.5px] text-[var(--g-ink-2)]">
					{preview.kind === 'realm' ? <>In {preview.org.display_name || preview.org.slug} · </> : null}
					as <b className="font-semibold">{role_label(preview.role)}</b>{preview.inviter ? <> · invited by {preview.inviter.display_name}</> : null} · expires {day_month(preview.expires_at)}
				</p>
				<p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">Sent to {preview.invitee_email}</p>
			</div>
			<div className="flex flex-col gap-4">
				<Auth_error text={error} />
				{user && email_ok ? (
					<>
						<p className="text-[14px] text-[var(--g-ink-2)]">Signed in as <b>@{user.username}</b>.</p>
						<button type="button" disabled={busy} onClick={() => void answer('accept')} className={AUTH_PRIMARY}>{busy ? 'Working…' : 'Accept'}</button>
						{decline}
					</>
				) : null}
				{user && !email_ok ? (
					<div className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-warn-soft)] px-3.5 py-3 text-[13px]" data-testid="email-mismatch">
						You’re signed in as <b>{user.email}</b>. This invite is for <b>{preview.invitee_email}</b>. Sign out and sign in with that address.
					</div>
				) : null}
				{!user && preview.account_exists ? (
					<>
						<p className="text-[14px] text-[var(--g-ink-2)]">This email already has a CliqHub account. Sign in to accept.</p>
						<Link to={`/login?redirect=${encodeURIComponent(here)}`} className={AUTH_PRIMARY}>Sign in to accept</Link>
						{decline}
					</>
				) : null}
				{!user && !preview.account_exists ? (
					<>
						<form onSubmit={create} className="flex flex-col gap-3.5" aria-label="Create your account">
							<p className="text-[14px] text-[var(--g-ink-2)]">New to CliqHub? Create your account for <b>{preview.invitee_email}</b>.</p>
							<label className="text-[12.5px] font-medium text-[var(--g-ink-2)]">Username<input aria-label="Username" required value={f.username} onChange={(e) => { set_f({ ...f, username: e.target.value }); set_username_error(null); }} autoComplete="username" autoCapitalize="none" spellCheck={false} aria-invalid={uname_bad || Boolean(username_error) || undefined} aria-describedby="username-hint" className={`${AUTH_INPUT} mt-1.5`} /></label>
							{username_error ? <p id="username-hint" role="alert" className="-mt-2 text-[12px] text-[var(--g-bad)]">{username_error}</p>
								: uname_bad ? <p id="username-hint" className="-mt-2 text-[12px] text-[var(--g-bad)]">Start with a letter; lowercase letters, numbers and hyphens only.</p>
								: <p id="username-hint" className="-mt-2 text-[11.5px] text-[var(--g-ink-3)]">Also your personal publishing scope (@username). Can’t be changed later.</p>}
							<label className="text-[12.5px] font-medium text-[var(--g-ink-2)]">Display name <span className="text-[var(--g-ink-3)]">(optional)</span><input aria-label="Display name" value={f.display_name} onChange={(e) => set_f({ ...f, display_name: e.target.value })} autoComplete="name" className={`${AUTH_INPUT} mt-1.5`} /></label>
							<label className="text-[12.5px] font-medium text-[var(--g-ink-2)]">Password <span className="text-[var(--g-ink-3)]">({PASSWORD_MIN}+ characters)</span><input aria-label="Password" required type="password" value={f.password} onChange={(e) => set_f({ ...f, password: e.target.value })} autoComplete="new-password" className={`${AUTH_INPUT} mt-1.5`} /></label>
							<button type="submit" disabled={busy || !f.username.trim() || uname_bad || f.password.length < PASSWORD_MIN} className={AUTH_PRIMARY}>{busy ? 'Creating…' : 'Create account & accept'}</button>
						</form>
						{decline}
					</>
				) : null}
			</div>
		</Auth_shell>
	);
}
