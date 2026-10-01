/** `/` (Graphite) — signed-out landing; signed-in users go straight to /home. */
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, Eye, Hand, Package, Terminal } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { Cliq_mark } from '@/components/cliq_mark';
import '@/styles/graphite.css';

const PIPELINE: Array<{ label: string; tone: string }> = [
	{ label: 'architect', tone: 'var(--g-t-llm)' },
	{ label: 'review', tone: 'var(--g-t-hug)' },
	{ label: 'implement', tone: 'var(--g-t-llm)' },
	{ label: 'check', tone: 'var(--g-t-gate)' },
	{ label: 'pr', tone: 'var(--g-t-conn)' },
];

const FEATURES = [
	{ icon: Package, title: 'Ready-made teams', text: 'Install a team someone already built, or design your own in the builder and share it.' },
	{ icon: Hand, title: 'Humans in the loop', text: 'Teams stop at review points so a person can approve, send back or change course.' },
	{ icon: Eye, title: 'See every run', text: 'Phases, gates, cost and output for every run, live — from one inbox.' },
	{ icon: Terminal, title: 'Your machines', text: 'Runs happen on your own daemons, so your code and keys stay with you.' },
];

export function Component() {
	const { user, loading } = useAuth();
	const navigate = useNavigate();
	useEffect(() => { if (!loading && user) navigate('/home', { replace: true }); }, [loading, user, navigate]);

	if (loading || user) return <div className="theme-graphite flex min-h-screen items-center justify-center"><p role="status" className="text-[13px] text-[var(--g-ink-3)]">Loading…</p></div>;

	return (
		<div className="theme-graphite min-h-screen">
			<header className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-5">
				<Link to="/" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight"><Cliq_mark class_name="h-7 w-7" title="CliqHub" />CliqHub</Link>
				<nav aria-label="Site" className="ml-auto flex items-center gap-5 text-[13.5px] text-[var(--g-ink-2)]">
					<Link to="/browse" className="hover:text-[var(--g-ink)]">Marketplace</Link>
					<a href="https://docs.getcliq.io" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--g-ink)]">Docs</a>
					<Link to="/login" className="rounded-lg bg-[var(--g-acc)] px-3.5 py-1.5 font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)]">Sign in</Link>
				</nav>
			</header>
			<main>
				<section className="relative overflow-hidden">
					<div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(var(--g-line)_1px,transparent_1px)] [background-size:22px_22px]" />
					<div aria-hidden className="pointer-events-none absolute left-1/2 top-[-160px] h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.22),transparent_65%)]" />
					<div className="relative mx-auto max-w-4xl px-6 pb-24 pt-20 text-center">
						<h1 className="text-[44px] font-semibold leading-[1.06] tracking-[-0.03em] sm:text-[60px]">Ready-made AI teams.<br />Your requirements.<br /><span className="text-[var(--g-acc)]">Your machines.</span></h1>
						<p className="mx-auto mt-6 max-w-[560px] text-[16px] leading-relaxed text-[var(--g-ink-3)]">Run multi-agent teams on your own daemons, with human review where it matters and a full record of every phase.</p>
						<ol aria-label="Example team" className="mt-10 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2">
							{PIPELINE.map((s, i) => (
								<li key={s.label} className="flex items-center gap-1.5">
									<span className="inline-flex items-center gap-2 rounded-lg border border-[var(--g-line)] bg-[var(--g-panel)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--g-ink-2)]"><span aria-hidden className="h-2 w-2 rounded-[3px]" style={{ background: s.tone }} />{s.label}</span>
									{i < PIPELINE.length - 1 ? <ArrowRight aria-hidden className="h-3.5 w-3.5 text-[var(--g-ink-3)]" /> : null}
								</li>
							))}
						</ol>
						<div className="mt-10 flex flex-wrap justify-center gap-3">
							<Link to="/login" className="rounded-[10px] bg-[var(--g-acc)] px-6 py-3 text-[14px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)]">Sign in to CliqHub</Link>
							<Link to="/browse" className="rounded-[10px] border border-[var(--g-line)] px-6 py-3 text-[14px] font-semibold hover:bg-[var(--g-soft)]">Browse teams</Link>
						</div>
						<p className="mt-4 text-[12.5px] text-[var(--g-ink-3)]">Invite only for now — your invite email has the link to set up an account.</p>
					</div>
				</section>
				<section aria-label="What you get" className="mx-auto grid max-w-6xl gap-4 px-6 pb-20 sm:grid-cols-2 lg:grid-cols-4">
					{FEATURES.map(({ icon: Icon, title, text }) => (
						<div key={title} className="rounded-[12px] border border-[var(--g-line)] bg-[var(--g-panel)] p-5">
							<Icon aria-hidden className="h-5 w-5 text-[var(--g-acc)]" />
							<h2 className="mt-3 text-[14px] font-semibold">{title}</h2>
							<p className="mt-1.5 text-[13px] leading-relaxed text-[var(--g-ink-3)]">{text}</p>
						</div>
					))}
				</section>
				<section aria-label="Get started" className="border-t border-[var(--g-line)] bg-[var(--g-side)]">
					<div className="mx-auto grid max-w-5xl gap-8 px-6 py-16 sm:grid-cols-3">
						{[['1', 'Install', 'One command on Mac, Linux or WSL, then cliq login.'], ['2', 'Pick a team', 'Install one from the marketplace or build your own.'], ['3', 'Run', 'Agents do the work; you review what matters.']].map(([n, t, d]) => (
							<div key={n}><span className="g-mono grid h-8 w-8 place-items-center rounded-full border border-[var(--g-acc-line)] text-[13px] text-[var(--g-acc)]">{n}</span><h3 className="mt-3 text-[14px] font-semibold">{t}</h3><p className="mt-1 text-[13px] text-[var(--g-ink-3)]">{d}</p></div>
						))}
					</div>
				</section>
			</main>
			<footer className="border-t border-[var(--g-line)] py-6 text-center text-[12.5px] text-[var(--g-ink-3)]">
				CliqHub · <a href="https://getcliq.io" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--g-ink)]">Get Cliq</a> · <a href="https://docs.getcliq.io" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--g-ink)]">Docs</a>
			</footer>
		</div>
	);
}
