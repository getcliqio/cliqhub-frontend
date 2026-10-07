/** /signup (Graphite) — CliqHub is invite-only: explain, point to sign-in or an invite link. */
import { Link, useSearchParams } from 'react-router';
import { Lock } from 'lucide-react';
import { Cliq_mark } from '@/components/cliq_mark';
import { safe_redirect } from '@/lib/safe_redirect';
import { Brand_panel } from '@/pages/login_page';
import '@/styles/graphite.css';
import { Theme_switch } from '@/components/graphite/theme_switch';

export function Component() {
	const [sp] = useSearchParams();
	const raw = sp.get('redirect');
	const redirect = raw ? safe_redirect(raw) : null;
	return (
		<div className="theme-graphite grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
			<Theme_switch class_name="fixed right-4 top-4 z-20" />
			<Brand_panel />
			<main className="flex min-h-screen items-center justify-center px-6 py-12">
				<div className="w-full max-w-[400px]">
					<Link to="/" className="mb-10 flex items-center gap-2.5 text-[15px] font-semibold lg:hidden"><Cliq_mark class_name="h-7 w-7" title="CliqHub" />CliqHub</Link>
					<span aria-hidden className="mb-6 grid h-12 w-12 place-items-center rounded-xl border border-[var(--g-line)] bg-[var(--g-panel)]"><Lock className="h-5 w-5 text-[var(--g-acc)]" /></span>
					<h1 className="text-[26px] font-semibold tracking-[-0.02em]">Invite only</h1>
					<p className="mt-2 text-[14px] leading-relaxed text-[var(--g-ink-3)]">CliqHub is in private beta. Accounts are created from an organization invitation — open the link in your invite email to set up your account.</p>
					<Link to={redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login'} className="mt-7 flex h-11 w-full items-center justify-center rounded-[10px] bg-[var(--g-acc)] text-[14px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)]">I have an account — sign in</Link>
					<p className="mt-6 text-[13px] text-[var(--g-ink-3)]">Invited to a realm but don’t have an account? Ask whoever invited you to invite you to their organization.</p>
				</div>
			</main>
		</div>
	);
}
