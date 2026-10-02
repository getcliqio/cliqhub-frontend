/**
 * Set a password from an email link (Graphite) — /reset/:token. Serves both
 * "Reset your password" and a new user's "Set your password" email.
 * BFF route (public with a token): users/change_password { reset_token, new_password };
 * on success the BFF signs the person in and the page goes to /home.
 * Expired, already used and unknown links each say so and offer a new link.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Check, Circle } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { password_rules } from '@/lib/account';
import { public_post } from '@/lib/public_post';
import { AUTH_INPUT, AUTH_PRIMARY, AUTH_SECONDARY, Auth_error, Auth_shell } from '@/components/graphite/g_auth';

type Dead = 'expired' | 'used' | 'unknown';
const DEAD_TEXT: Record<Dead, { title: string; body: string }> = {
	expired: { title: 'This link has expired', body: 'Links in password emails work for a limited time. Ask for a new one.' },
	used: { title: 'This link was already used', body: 'Each link sets a password once. Sign in, or ask for a new link.' },
	unknown: { title: 'This link isn’t valid', body: 'Check the link in your email, or ask for a new one.' },
};

export function Component() {
	const { token = '' } = useParams();
	const navigate = useNavigate();
	const { refresh } = useAuth();
	const [pw, set_pw] = useState('');
	const [confirm, set_confirm] = useState('');
	const [busy, set_busy] = useState(false);
	const [error, set_error] = useState<string | null>(null);
	const [dead, set_dead] = useState<Dead | null>(null);
	const rules = password_rules(pw, confirm);
	const ready = rules.every((r) => r.ok);

	async function submit(e: FormEvent) {
		e.preventDefault();
		set_busy(true); set_error(null);
		const r = await public_post('/v1/users/change_password', { reset_token: token, new_password: pw }, 'Could not set the password.');
		set_busy(false);
		if (!r.ok) {
			if (r.code === 'expired') set_dead('expired');
			else if (r.code === 'not_pending') set_dead('used');
			else if (r.code === 'not_found') set_dead('unknown');
			else set_error(r.error);
			return;
		}
		await refresh();
		navigate('/home', { replace: true });
	}

	if (dead) {
		const t = DEAD_TEXT[dead];
		return (
			<Auth_shell>
				<h1 className="text-[24px] font-semibold tracking-[-0.02em]">{t.title}</h1>
				<p className="mt-2 text-[14px] text-[var(--g-ink-3)]">{t.body}</p>
				<Link to="/forgot-password" className={`${AUTH_PRIMARY} mt-7`}>Send me a new link</Link>
				<Link to="/login" className={`${AUTH_SECONDARY} mt-3`}>Sign in</Link>
			</Auth_shell>
		);
	}

	return (
		<Auth_shell>
			<h1 className="text-[26px] font-semibold tracking-[-0.02em]">Set your password</h1>
			<p className="mt-1.5 text-[14px] text-[var(--g-ink-3)]">Choose a password for your CliqHub account. You’ll be signed in when it’s saved.</p>
			<form onSubmit={(e) => void submit(e)} className="mt-7 flex flex-col gap-3.5" aria-label="Set your password">
				<label className="text-[12.5px] font-medium text-[var(--g-ink-2)]">New password<input aria-label="New password" type="password" autoComplete="new-password" required value={pw} onChange={(e) => set_pw(e.target.value)} aria-describedby="password-rules" className={`${AUTH_INPUT} mt-1.5`} /></label>
				<label className="text-[12.5px] font-medium text-[var(--g-ink-2)]">Confirm password<input aria-label="Confirm password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => set_confirm(e.target.value)} aria-describedby="password-rules" className={`${AUTH_INPUT} mt-1.5`} /></label>
				<ul id="password-rules" aria-label="Password rules" className="flex flex-col gap-1 text-[12.5px]">
					{rules.map((r) => (
						<li key={r.label} data-ok={r.ok} className={`flex items-center gap-2 ${r.ok ? 'text-[var(--g-ok)]' : 'text-[var(--g-ink-3)]'}`}>
							{r.ok ? <Check aria-hidden className="h-3.5 w-3.5" /> : <Circle aria-hidden className="h-3.5 w-3.5" />}
							{r.label}<span className="sr-only">{r.ok ? ' (met)' : ' (not met)'}</span>
						</li>
					))}
				</ul>
				<Auth_error text={error} />
				<button type="submit" disabled={busy || !ready} className={AUTH_PRIMARY}>{busy ? 'Saving…' : 'Save password and sign in'}</button>
			</form>
		</Auth_shell>
	);
}
