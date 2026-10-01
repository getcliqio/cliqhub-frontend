/**
 * Accept an invitation (Graphite) — /invite/:token (org) and /realm-invite/:token (realm).
 * Core routes: invitations/get_by_token (preview) · invitations/accept.
 *   org   signed in (email must match) → accept → /home;
 *         signed out → create your account here (username, name, password) → accept.
 *   realm signed in (email must match) → accept → /realms?joined=slug;
 *         signed out → sign in first (Core accepts realm invites only for existing accounts).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { Cliq_mark } from '@/components/cliq_mark';
import { Brand_panel } from '@/pages/login_page';
import '@/styles/graphite.css';

interface Preview { target_type?: 'org' | 'realm'; email: string; role?: string; org_slug?: string; org_display_name?: string; realm_id?: string; realm_slug?: string; realm_name?: string; expires_at?: string }

const INPUT = 'h-11 w-full rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-3.5 text-[14px] text-[var(--g-ink)] outline-none placeholder:text-[var(--g-ink-3)] focus:border-[var(--g-acc-line)] focus:ring-4 focus:ring-[var(--g-acc-soft)]';
const PRIMARY = 'flex h-11 w-full items-center justify-center rounded-[10px] bg-[var(--g-acc)] text-[14px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:cursor-not-allowed disabled:opacity-40';
const SECONDARY = 'flex h-11 w-full items-center justify-center rounded-[10px] border border-[var(--g-line)] text-[14px] font-semibold text-[var(--g-ink)] hover:bg-[var(--g-soft)]';
const USERNAME_RE = /^[a-z][a-z0-9-]*$/;

function msg_of(d: { error?: string | { message?: string } } | null, fallback: string): string {
	if (!d) return fallback;
	return typeof d.error === 'string' ? d.error : d.error?.message ?? fallback;
}
async function post(path: string, body: Record<string, unknown>) {
	const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	const data = await res.json().catch(() => null);
	return { ok: Boolean(res.ok && data?.ok), data, status: res.status };
}

function Shell({ children }: { children: React.ReactNode }) {
	return (
		<div className="theme-graphite grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
			<Brand_panel />
			<main className="flex min-h-screen items-center justify-center px-6 py-12">
				<div className="w-full max-w-[400px]">
					<Link to="/" className="mb-10 flex items-center gap-2.5 text-[15px] font-semibold lg:hidden"><Cliq_mark class_name="h-7 w-7" title="CliqHub" />CliqHub</Link>
					{children}
				</div>
			</main>
		</div>
	);
}

function Err({ text }: { text: string | null }) {
	if (!text) return null;
	return <div role="alert" className="flex items-start gap-2 rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] px-3.5 py-2.5 text-[13px]"><AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[var(--g-bad)]" /><span>{text}</span></div>;
}

export function Component() {
	const { token = '' } = useParams();
	const { pathname } = useLocation();
	const kind: 'org' | 'realm' = pathname.startsWith('/realm-invite/') ? 'realm' : 'org';
	const navigate = useNavigate();
	const { user, loading: auth_loading, refresh } = useAuth();
	const [preview, set_preview] = useState<Preview | null>(null);
	const [state, set_state] = useState<'loading' | 'ready' | 'invalid'>('loading');
	const [error, set_error] = useState<string | null>(null);
	const [busy, set_busy] = useState(false);
	const [f, set_f] = useState({ username: '', display_name: '', password: '' });

	useEffect(() => {
		let off = false;
		void (async () => {
			try {
				const r = await post('/v1/invitations/get_by_token', { token });
				if (off) return;
				if (!r.ok) { set_error(msg_of(r.data, 'This invitation is invalid or has expired.')); set_state('invalid'); return; }
				set_preview(r.data.data as Preview); set_state('ready');
			} catch { if (!off) { set_error('Could not load the invitation.'); set_state('invalid'); } }
		})();
		return () => { off = true; };
	}, [token]);

	const here = `/${kind === 'org' ? 'invite' : 'realm-invite'}/${encodeURIComponent(token)}`;
	const is_realm = kind === 'realm' || preview?.target_type === 'realm';
	const target = is_realm ? (preview?.realm_name || preview?.realm_slug || 'a realm') : (preview?.org_display_name || preview?.org_slug || 'an organization');
	const email_ok = Boolean(user?.email && preview?.email && user.email.trim().toLowerCase() === preview.email.trim().toLowerCase());

	async function accept(body: Record<string, unknown> = {}) {
		set_busy(true); set_error(null);
		const r = await post('/v1/invitations/accept', { token, ...body });
		if (!r.ok) { set_busy(false); set_error(msg_of(r.data, 'Could not accept the invitation.')); return; }
		await refresh();
		const slug = (r.data?.data?.realm_slug as string | undefined) ?? preview?.realm_slug;
		navigate(is_realm ? `/realms${slug ? `?joined=${encodeURIComponent(slug)}` : ''}` : '/home', { replace: true });
	}
	function create(e: FormEvent) {
		e.preventDefault();
		void accept({ username: f.username.trim().toLowerCase(), password: f.password, ...(f.display_name.trim() ? { display_name: f.display_name.trim() } : {}) });
	}

	if (state === 'loading' || auth_loading) return <Shell><p role="status" className="text-[13px] text-[var(--g-ink-3)]">Loading invitation…</p></Shell>;
	if (state === 'invalid' || !preview) {
		return (
			<Shell>
				<h1 className="text-[24px] font-semibold tracking-[-0.02em]">Invitation unavailable</h1>
				<p className="mt-2 text-[14px] text-[var(--g-ink-3)]">{error ?? 'This invitation is invalid or has expired.'} Ask whoever invited you to send a new one.</p>
				<Link to={user ? '/home' : '/login'} className={`${SECONDARY} mt-7`}>{user ? 'Go to CliqHub' : 'Sign in'}</Link>
			</Shell>
		);
	}

	const uname_bad = f.username.length > 0 && !USERNAME_RE.test(f.username.trim().toLowerCase());
	return (
		<Shell>
			<div className="mb-7 rounded-xl border border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] px-4 py-3 text-[13px]" data-testid="invite-summary">
				You’re invited to {is_realm ? 'the realm ' : ''}<b className="font-semibold">{is_realm && preview.org_slug ? `${preview.org_slug} / ` : ''}{target}</b>{preview.role ? <> as <b className="font-semibold capitalize">{preview.role}</b></> : null}
				<div className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">Sent to {preview.email}{preview.expires_at ? ` · expires ${new Date(preview.expires_at).toLocaleDateString()}` : ''}</div>
			</div>
			<h1 className="text-[26px] font-semibold tracking-[-0.02em]">Join {target}</h1>
			<div className="mt-6 flex flex-col gap-4">
				<Err text={error} />
				{user && email_ok ? (
					<>
						<p className="text-[14px] text-[var(--g-ink-2)]">Signed in as <b>@{user.username}</b>.</p>
						<button type="button" disabled={busy} onClick={() => void accept()} className={PRIMARY}>{busy ? 'Joining…' : 'Accept invitation'}</button>
					</>
				) : null}
				{user && !email_ok ? (
					<div className="rounded-[10px] border border-[var(--g-warn-line,var(--g-line))] bg-[var(--g-warn-soft)] px-3.5 py-3 text-[13px]">
						You’re signed in as <b>{user.email}</b>, but this invitation is for <b>{preview.email}</b>. Sign out and sign in with that email to accept it.
					</div>
				) : null}
				{!user ? (
					<>
						<form onSubmit={create} className="flex flex-col gap-3.5" aria-label="Create your account">
							<p className="text-[14px] text-[var(--g-ink-2)]">New to CliqHub? Create your account for <b>{preview.email}</b>.</p>
							<label className="text-[12.5px] font-medium text-[var(--g-ink-2)]">Username<input aria-label="Username" required value={f.username} onChange={(e) => set_f({ ...f, username: e.target.value })} autoComplete="username" autoCapitalize="none" spellCheck={false} className={`${INPUT} mt-1.5`} /></label>
							{uname_bad ? <p className="-mt-2 text-[12px] text-[var(--g-bad)]">Start with a letter; lowercase letters, numbers and hyphens only.</p> : <p className="-mt-2 text-[11.5px] text-[var(--g-ink-3)]">Also your personal publishing scope (@username). Can’t be changed later.</p>}
							<label className="text-[12.5px] font-medium text-[var(--g-ink-2)]">Display name <span className="text-[var(--g-ink-3)]">(optional)</span><input aria-label="Display name" value={f.display_name} onChange={(e) => set_f({ ...f, display_name: e.target.value })} autoComplete="name" className={`${INPUT} mt-1.5`} /></label>
							<label className="text-[12.5px] font-medium text-[var(--g-ink-2)]">Password <span className="text-[var(--g-ink-3)]">(8+ characters)</span><input aria-label="Password" required type="password" value={f.password} onChange={(e) => set_f({ ...f, password: e.target.value })} autoComplete="new-password" className={`${INPUT} mt-1.5`} /></label>
							<button type="submit" disabled={busy || !f.username.trim() || uname_bad || f.password.length < 8} className={PRIMARY}>{busy ? 'Creating…' : 'Create account & join'}</button>
						</form>
						<p className="text-[13px] text-[var(--g-ink-3)]">Already have an account? <Link to={`/login?redirect=${encodeURIComponent(here)}`} className="font-medium text-[var(--g-acc)] hover:underline">Sign in</Link></p>
					</>
				) : null}
			</div>
		</Shell>
	);
}
