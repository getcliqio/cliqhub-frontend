import { Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AlertCircle, ArrowRight, Eye, EyeOff, Terminal } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { Cliq_mark } from '@/components/cliq_mark';
import { invite_from_redirect, safe_redirect, type Invite_target } from '@/lib/safe_redirect';
import '@/styles/graphite.css';

/* -------------------------------------------------------------------------- */
/* Invite preview                                                             */
/* -------------------------------------------------------------------------- */

interface Invite_preview {
	kind: Invite_target['kind'];
	/** Org or realm display name. */
	name: string;
	/** Parent org slug for realm invites, when known. */
	context: string | null;
	role: string | null;
	email: string | null;
}

type Invite_state =
	| { status: 'none' }
	| { status: 'loading' }
	| { status: 'ready'; preview: Invite_preview }
	| { status: 'invalid'; message: string };

function to_preview(kind: Invite_target['kind'], raw: Record<string, unknown>): Invite_preview {
	const str = (k: string): string | null => (typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : null);
	const is_realm = kind === 'realm' || raw.target_type === 'realm';
	return {
		kind: is_realm ? 'realm' : 'org',
		name: is_realm
			? (str('realm_name') ?? str('realm_slug') ?? 'a realm')
			: (str('org_display_name') ?? str('org_slug') ?? 'CliqHub'),
		context: is_realm ? str('org_slug') : null,
		role: str('role'),
		email: str('email'),
	};
}

function use_invite_preview(target: Invite_target | null): Invite_state {
	const [state, set_state] = useState<Invite_state>(target ? { status: 'loading' } : { status: 'none' });

	useEffect(() => {
		if (!target) {
			set_state({ status: 'none' });
			return;
		}
		let cancelled = false;
		set_state({ status: 'loading' });
		(async () => {
			try {
				const res = await fetch('/v1/invitations/get_by_token', {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ token: target.token }),
				});
				const data = await res.json();
				if (cancelled) return;
				if (!data?.ok) {
					const message = typeof data?.error === 'string'
						? data.error
						: (data?.error?.message ?? 'This invitation is no longer valid.');
					set_state({ status: 'invalid', message });
					return;
				}
				set_state({ status: 'ready', preview: to_preview(target.kind, data.data ?? {}) });
			} catch {
				if (!cancelled) set_state({ status: 'invalid', message: 'Could not load the invitation.' });
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [target?.kind, target?.token]); // eslint-disable-line react-hooks/exhaustive-deps

	return state;
}

/* -------------------------------------------------------------------------- */
/* Brand panel                                                                */
/* -------------------------------------------------------------------------- */

const PIPELINE: Array<{ label: string; tone: string }> = [
	{ label: 'architect', tone: 'var(--g-t-llm)' },
	{ label: 'review', tone: 'var(--g-t-hug)' },
	{ label: 'implement', tone: 'var(--g-t-llm)' },
	{ label: 'check', tone: 'var(--g-t-gate)' },
	{ label: 'pr', tone: 'var(--g-t-conn)' },
];

export function Brand_panel() {
	return (
		<section
			aria-label="About CliqHub"
			className="relative hidden flex-col justify-between overflow-hidden border-r border-[var(--g-line)] bg-[var(--g-side)] px-14 py-12 lg:flex"
		>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(var(--g-line)_1px,transparent_1px)] [background-size:22px_22px]"
			/>
			<div
				aria-hidden
				className="pointer-events-none absolute -left-32 -top-32 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.22),transparent_65%)]"
			/>

			<Link to="/" className="relative flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
				<Cliq_mark class_name="h-7 w-7" title="CliqHub" />
				CliqHub
			</Link>

			<div className="relative max-w-[600px]">
				<h1 className="text-[40px] font-semibold leading-[1.08] tracking-[-0.03em]">
					Ready-made AI teams.
					<br />
					Your requirements.
					<br />
					<span className="text-[var(--g-acc)]">Your machines.</span>
				</h1>
				<p className="mt-5 max-w-[480px] text-[15px] leading-relaxed text-[var(--g-ink-3)]">
					Run multi-agent teams on your own daemons, with human review where it matters and a
					full record of every phase.
				</p>

				<ol aria-label="Example team" className="mt-10 flex flex-wrap items-center gap-x-1.5 gap-y-2">
					{PIPELINE.map((step, i) => (
						<li key={step.label} className="flex items-center gap-1.5">
							<span className="inline-flex items-center gap-2 rounded-lg border border-[var(--g-line)] bg-[var(--g-panel)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--g-ink-2)]">
								<span aria-hidden className="h-2 w-2 rounded-[3px]" style={{ background: step.tone }} />
								{step.label}
							</span>
							{i < PIPELINE.length - 1 ? (
								<ArrowRight aria-hidden className="h-3.5 w-3.5 text-[var(--g-ink-3)]" />
							) : null}
						</li>
					))}
				</ol>
			</div>

			<ul className="relative space-y-2.5 text-[13px] text-[var(--g-ink-3)]">
				<li className="flex gap-2.5"><span className="text-[var(--g-acc)]">—</span>See every run live: phases, gates, cost.</li>
				<li className="flex gap-2.5"><span className="text-[var(--g-acc)]">—</span>Approve, send back or reject from one inbox.</li>
				<li className="flex gap-2.5"><span className="text-[var(--g-acc)]">—</span>Your code and keys stay on your daemons.</li>
			</ul>
		</section>
	);
}

/* -------------------------------------------------------------------------- */
/* Form                                                                       */
/* -------------------------------------------------------------------------- */

function Invite_card({ state }: { state: Invite_state }) {
	if (state.status === 'none') return null;
	if (state.status === 'loading') {
		return (
			<div
				data-testid="invite-card"
				className="mb-7 h-[68px] animate-pulse rounded-xl border border-[var(--g-line)] bg-[var(--g-panel)]"
			/>
		);
	}
	if (state.status === 'invalid') {
		return (
			<div
				data-testid="invite-card"
				role="status"
				className="mb-7 rounded-xl border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-3 text-[13px] text-[var(--g-ink-3)]"
			>
				<b className="font-semibold text-[var(--g-ink-2)]">Invitation unavailable.</b> {state.message} You can
				still sign in.
			</div>
		);
	}
	const { preview } = state;
	const initials = preview.name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || 'CQ';
	return (
		<div
			data-testid="invite-card"
			className="mb-7 flex items-center gap-3 rounded-xl border border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] px-4 py-3"
		>
			<span
				aria-hidden
				className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-[12px] font-bold text-white"
			>
				{initials}
			</span>
			<div className="min-w-0 text-[13px] leading-snug">
				<p>
					You're invited to{' '}
					<b className="font-semibold">
						{preview.context ? `${preview.context} / ` : ''}
						{preview.name}
					</b>
					{preview.role ? (
						<>
							{' '}as <b className="font-semibold capitalize">{preview.role}</b>
						</>
					) : null}
				</p>
				<p className="mt-0.5 truncate text-[12px] text-[var(--g-ink-3)]">
					Sign in to accept{preview.email ? ` · sent to ${preview.email}` : ''}
				</p>
			</div>
		</div>
	);
}

function Login_form() {
	const { user, loading, login } = useAuth();
	const navigate = useNavigate();
	const [search_params] = useSearchParams();

	const redirect = useMemo(() => safe_redirect(search_params.get('redirect')), [search_params]);
	const invite_target = useMemo(() => invite_from_redirect(redirect), [redirect]);
	const invite = use_invite_preview(invite_target);

	const [username, set_username] = useState('');
	const [password, set_password] = useState('');
	const [show_password, set_show_password] = useState(false);
	const [caps_lock, set_caps_lock] = useState(false);
	const [error, set_error] = useState('');
	const [submitting, set_submitting] = useState(false);

	useEffect(() => {
		if (!loading && user) navigate(redirect, { replace: true });
	}, [loading, user, navigate, redirect]);

	async function handle_submit(e: React.FormEvent) {
		e.preventDefault();
		if (submitting) return;
		set_error('');
		set_submitting(true);
		const err = await login(username.trim().toLowerCase(), password);
		if (err) {
			set_error(err);
			set_submitting(false);
		}
		// On success the effect above navigates once the session hydrates.
	}

	function track_caps(e: React.KeyboardEvent<HTMLInputElement>) {
		set_caps_lock(e.getModifierState?.('CapsLock') ?? false);
	}

	const can_submit = !submitting && username.trim().length > 0 && password.length > 0;
	const is_invite = invite.status === 'ready';
	const signup_href = invite_target
		? `/${invite_target.kind === 'org' ? 'invite' : 'realm-invite'}/${encodeURIComponent(invite_target.token)}`
		: null;

	const input_class =
		'h-11 w-full rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-3.5 text-[14px] text-[var(--g-ink)] outline-none transition placeholder:text-[var(--g-ink-3)] focus:border-[var(--g-acc-line)] focus:ring-4 focus:ring-[var(--g-acc-soft)] aria-[invalid=true]:border-[var(--g-bad-line)]';

	if (loading || user) {
		return (
			<div className="flex flex-1 items-center justify-center" role="status" aria-live="polite">
				<p className="text-[13px] text-[var(--g-ink-3)]">{user ? 'Signing you in…' : 'Loading…'}</p>
			</div>
		);
	}

	return (
		<div className="flex flex-1 items-center justify-center px-6 py-12">
			<div className="w-full max-w-[400px]">
				<Link to="/" className="mb-10 flex items-center gap-2.5 text-[15px] font-semibold lg:hidden">
					<Cliq_mark class_name="h-7 w-7" title="CliqHub" />
					CliqHub
				</Link>

				<Invite_card state={invite} />

				<h2 className="text-[26px] font-semibold tracking-[-0.02em]">Sign in</h2>
				<p className="mt-1.5 text-[14px] text-[var(--g-ink-3)]">
					{is_invite ? 'Use your CliqHub account to accept the invitation.' : 'Welcome back. Use your CliqHub username.'}
				</p>

				<form onSubmit={handle_submit} className="mt-7 space-y-4" noValidate>
					<div>
						<label htmlFor="username" className="mb-1.5 block text-[12.5px] font-medium text-[var(--g-ink-2)]">
							Username
						</label>
						<input
							id="username"
							name="username"
							type="text"
							value={username}
							onChange={(e) => set_username(e.target.value)}
							autoComplete="username"
							autoCapitalize="none"
							autoCorrect="off"
							spellCheck={false}
							autoFocus
							required
							aria-invalid={error ? true : undefined}
							className={input_class}
						/>
					</div>

					<div>
						<label htmlFor="password" className="mb-1.5 block text-[12.5px] font-medium text-[var(--g-ink-2)]">
							Password
						</label>
						<div className="relative">
							<input
								id="password"
								name="password"
								type={show_password ? 'text' : 'password'}
								value={password}
								onChange={(e) => set_password(e.target.value)}
								onKeyUp={track_caps}
								onKeyDown={track_caps}
								autoComplete="current-password"
								required
								aria-invalid={error ? true : undefined}
								aria-describedby={caps_lock ? 'caps-lock-hint' : undefined}
								className={`${input_class} pr-11`}
							/>
							<button
								type="button"
								onClick={() => set_show_password((v) => !v)}
								aria-label={show_password ? 'Hide password' : 'Show password'}
								aria-pressed={show_password}
								className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-[var(--g-ink-3)] hover:bg-[var(--g-hover)] hover:text-[var(--g-ink)]"
							>
								{show_password ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
							</button>
						</div>
						{caps_lock ? (
							<p id="caps-lock-hint" className="mt-1.5 text-[12px] text-[var(--g-warn-text)]">
								Caps Lock is on.
							</p>
						) : null}
					</div>

					{error ? (
						<div
							role="alert"
							className="flex items-start gap-2 rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] px-3.5 py-2.5 text-[13px] text-[var(--g-ink)]"
						>
							<AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[var(--g-bad)]" />
							<span>{error}</span>
						</div>
					) : null}

					<button
						type="submit"
						disabled={!can_submit}
						className="h-11 w-full rounded-[10px] bg-[var(--g-acc)] text-[14px] font-semibold text-[var(--g-on-acc)] transition hover:bg-[var(--g-acc-hover)] disabled:cursor-not-allowed disabled:opacity-40"
					>
						{submitting ? 'Signing in…' : is_invite ? 'Sign in & accept invite' : 'Sign in'}
					</button>
				</form>

				<p className="mt-6 text-[13px] text-[var(--g-ink-3)]">
					{signup_href ? (
						<>
							New to CliqHub?{' '}
							<Link to={signup_href} className="font-medium text-[var(--g-acc)] hover:underline">
								Create an account
							</Link>
						</>
					) : (
						<>Need access? Ask a CliqHub admin for an invite.</>
					)}
				</p>

				<div className="mt-10 flex items-center gap-2.5 border-t border-[var(--g-line)] pt-5 text-[12px] text-[var(--g-ink-3)]">
					<Terminal aria-hidden className="h-3.5 w-3.5" />
					<span>
						Using the CLI? Run <code className="g-mono rounded bg-[var(--g-soft)] px-1.5 py-0.5 text-[var(--g-ink-2)]">cliq login</code>
					</span>
					<a
						href="https://docs.getcliq.io"
						target="_blank"
						rel="noopener noreferrer"
						className="ml-auto hover:text-[var(--g-ink)]"
					>
						Docs
					</a>
				</div>
			</div>
		</div>
	);
}

export function Component() {
	return (
		<div className="theme-graphite grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
			<Brand_panel />
			<main className="flex min-h-screen flex-col">
				<Suspense fallback={null}>
					<Login_form />
				</Suspense>
			</main>
		</div>
	);
}
