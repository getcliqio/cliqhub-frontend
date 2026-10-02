/**
 * Forgot password (Graphite) — /forgot-password, linked from sign-in.
 * BFF route (public): users/reset_password { email }. The answer never says
 * whether the email has an account; only `429 rate_limited` is shown as such.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { MailCheck } from 'lucide-react';
import { looks_like_email } from '@/lib/invites';
import { public_post } from '@/lib/public_post';
import { AUTH_INPUT, AUTH_PRIMARY, AUTH_SECONDARY, Auth_error, Auth_shell } from '@/components/graphite/g_auth';

const FORGOT_SENT = 'If that email has an account, a reset link is on its way.';
const RATE_LIMITED = 'Too many reset requests. Wait an hour and try again.';

export function Component() {
	const [email, set_email] = useState('');
	const [busy, set_busy] = useState(false);
	const [sent, set_sent] = useState(false);
	const [error, set_error] = useState<string | null>(null);

	async function submit(e: FormEvent) {
		e.preventDefault();
		set_busy(true); set_error(null);
		const r = await public_post('/v1/users/reset_password', { email: email.trim() }, 'Could not send the reset link.');
		set_busy(false);
		if (r.ok) { set_sent(true); return; }
		set_error(r.code === 'rate_limited' || r.status === 429 ? RATE_LIMITED : r.error);
	}

	return (
		<Auth_shell>
			<h1 className="text-[26px] font-semibold tracking-[-0.02em]">Forgot your password?</h1>
			{sent ? (
				<>
					<div role="status" className="mt-6 flex items-start gap-2.5 rounded-[10px] border border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] px-3.5 py-3 text-[13.5px]">
						<MailCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[var(--g-acc)]" />
						<span>{FORGOT_SENT}</span>
					</div>
					<Link to="/login" className={`${AUTH_SECONDARY} mt-7`}>Back to sign in</Link>
				</>
			) : (
				<>
					<p className="mt-1.5 text-[14px] text-[var(--g-ink-3)]">Enter the email on your account and we’ll send you a link to set a new password.</p>
					<form onSubmit={(e) => void submit(e)} className="mt-7 flex flex-col gap-3.5" aria-label="Forgot password">
						<label className="text-[12.5px] font-medium text-[var(--g-ink-2)]">Email<input aria-label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => set_email(e.target.value)} className={`${AUTH_INPUT} mt-1.5`} /></label>
						<Auth_error text={error} />
						<button type="submit" disabled={busy || !looks_like_email(email)} className={AUTH_PRIMARY}>{busy ? 'Sending…' : 'Send reset link'}</button>
					</form>
					<p className="mt-6 text-[13px] text-[var(--g-ink-3)]"><Link to="/login" className="font-medium text-[var(--g-acc)] hover:underline">Back to sign in</Link></p>
				</>
			)}
		</Auth_shell>
	);
}
