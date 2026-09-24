import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router';
import { useAuth } from '@/lib/auth_context';

export function Component() {
    const { user, loading } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (!loading && user) {
            navigate('/home', { replace: true });
        }
    }, [loading, user, navigate]);

    if (loading || user) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center">
                <p className="text-sm text-slate-400">Loading...</p>
            </div>
        );
    }

    return (
        <div>
            {/* Hero */}
            <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-purple-950 py-32">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,119,198,0.3),transparent)]" />
                <div className="relative mx-auto max-w-4xl px-6 text-center">
                    <h1 className="mb-6 text-5xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-7xl">
                        AI teams.<br />
                        <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                            For everyone, by everyone.
                        </span>
                    </h1>
                    <p className="mx-auto mb-12 max-w-2xl text-xl leading-relaxed text-indigo-100/80">
                        A community of AI team builders.
                        Build your team. Share it. Grab what others have built.
                        Install and run in 60 seconds.
                    </p>

                    <div className="text-center">
                        <Link
                            to="/login"
                            className="inline-block rounded-2xl bg-white px-10 py-4 text-lg font-extrabold text-slate-900 shadow-xl shadow-white/10 transition hover:scale-[1.02] hover:shadow-white/20"
                        >
                            Log in to CliqHub
                        </Link>
                    </div>
                </div>
            </section>

            {/* What is it */}
            <section className="mx-auto max-w-5xl px-6 py-28">
                <div className="mb-16 text-center">
                    <h2 className="mb-4 text-3xl font-extrabold text-slate-900 sm:text-4xl">
                        Teamwork, but for AI agents
                    </h2>
                    <p className="mx-auto max-w-2xl text-lg text-slate-500">
                        Think of it like GitHub for agent workflows. You design a team of
                        AI agents, wire them together, and let them loose. When something
                        needs a human eye, they stop and ask. When you&apos;re happy with it,
                        share it so anyone can use it.
                    </p>
                </div>
                <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                    <FeatureCard
                        emoji="🎨"
                        title="Design visually"
                        description="Drag, drop, connect. The builder makes team creation feel like play, not programming."
                    />
                    <FeatureCard
                        emoji="🤝"
                        title="Humans in the loop"
                        description="Set review checkpoints so a real person can approve, tweak, or redirect before agents continue."
                    />
                    <FeatureCard
                        emoji="📦"
                        title="Share with everyone"
                        description="Publish your team to the hub. Others install it in seconds and make it their own."
                    />
                    <FeatureCard
                        emoji="⚡"
                        title="One command to run"
                        description="cliq run. That's it. Your whole pipeline kicks off, agents collaborate, results land."
                    />
                </div>
            </section>

            {/* Community callout */}
            <section className="border-t border-slate-200 bg-white py-28">
                <div className="mx-auto max-w-3xl px-6 text-center">
                    <p className="mb-4 text-5xl">🚀</p>
                    <h2 className="mb-5 text-3xl font-extrabold text-slate-900 sm:text-4xl">
                        Better together
                    </h2>
                    <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed text-slate-500">
                        The best teams get shared. Someone builds a killer code review pipeline,
                        you install it. You build a content workflow that slaps, the community
                        grabs it. Everyone levels up.
                    </p>
                    <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                        <Link
                            to="/login"
                            className="rounded-xl bg-indigo-600 px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700"
                        >
                            Log in to CliqHub
                        </Link>
                        <a
                            href="https://getcliq.io"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-xl border border-slate-200 px-8 py-3.5 text-sm font-bold text-slate-700 transition hover:border-emerald-200 hover:text-emerald-600"
                        >
                            Get Cliq — it&apos;s free
                        </a>
                    </div>
                </div>
            </section>

            {/* How it works — quick and punchy */}
            <section className="mx-auto max-w-4xl px-6 py-28">
                <h2 className="mb-14 text-center text-3xl font-extrabold text-slate-900">
                    Up and running in minutes
                </h2>
                <div className="grid gap-12 sm:grid-cols-3">
                    <Step number="1" title="Install">
                        One curl command. Done. Works on Mac, Linux, and WSL.
                    </Step>
                    <Step number="2" title="Build or browse">
                        Create a team from scratch in the visual builder or install one
                        someone already shared.
                    </Step>
                    <Step number="3" title="Run">
                        Your agents do the work. You review what matters.
                        Ship when you&apos;re ready.
                    </Step>
                </div>
            </section>
        </div>
    );
}

function FeatureCard({ emoji, title, description }: { emoji: string; title: string; description: string }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-50">
            <p className="mb-3 text-2xl">{emoji}</p>
            <h3 className="mb-2 text-sm font-bold text-slate-900">{title}</h3>
            <p className="text-sm leading-relaxed text-slate-500">{description}</p>
        </div>
    );
}

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
    return (
        <div className="text-center">
            <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
                {number}
            </div>
            <h3 className="mb-2 font-bold text-slate-900">{title}</h3>
            <p className="text-sm leading-relaxed text-slate-500">{children}</p>
        </div>
    );
}
