/**
 * Signed-out page frame (Graphite) for the invite, set-password and
 * forgot-password pages: the brand panel on wide screens, the form on the
 * right, plus the shared input / button classes and the inline error box.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { AlertCircle } from 'lucide-react';
import { Cliq_mark } from '@/components/cliq_mark';
import { Brand_panel } from '@/pages/login_page';
import '@/styles/graphite.css';

export const AUTH_INPUT = 'h-11 w-full rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-3.5 text-[14px] text-[var(--g-ink)] outline-none placeholder:text-[var(--g-ink-3)] focus:border-[var(--g-acc-line)] focus:ring-4 focus:ring-[var(--g-acc-soft)]';
export const AUTH_PRIMARY = 'flex h-11 w-full items-center justify-center rounded-[10px] bg-[var(--g-acc)] text-[14px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:cursor-not-allowed disabled:opacity-40';
export const AUTH_SECONDARY = 'flex h-11 w-full items-center justify-center rounded-[10px] border border-[var(--g-line)] text-[14px] font-semibold text-[var(--g-ink)] hover:bg-[var(--g-soft)] disabled:opacity-40';

/** Signed-out page frame: brand panel on wide screens, the content on the right. */
export function Auth_shell({ children }: { children: ReactNode }) {
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

/** Inline error box used by the signed-out pages. */
export function Auth_error({ text }: { text: string | null }) {
	if (!text) return null;
	return <div role="alert" className="flex items-start gap-2 rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] px-3.5 py-2.5 text-[13px]"><AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[var(--g-bad)]" /><span>{text}</span></div>;
}
