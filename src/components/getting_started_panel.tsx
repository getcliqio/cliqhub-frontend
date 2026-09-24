import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Rocket, Terminal, Settings, LogIn, Monitor, Package, Play, ArrowRight, Copy, Check } from 'lucide-react';
import { useHubActivity } from '@/lib/hub_activity_context';
import { realm_qualified_label } from '@/lib/realm_url';

/** Renders a numbered step card with an icon, title, hint, and arbitrary children. */
function Step({
    n,
    icon: Icon,
    title,
    hint,
    children,
}: {
    n: number;
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    hint: string;
    children: ReactNode;
}) {
    return (
        <li className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-indigo-500/20 dark:bg-indigo-500/10">
            <div className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                    {n}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-indigo-500" />
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
                    {children}
                </div>
            </div>
        </li>
    );
}

/** CLI code block with a copy-to-clipboard button. */
function Code({ children }: { children: string }) {
    const [copied, set_copied] = useState(false);

    function handle_copy() {
        navigator.clipboard.writeText(children);
        set_copied(true);
        setTimeout(() => set_copied(false), 1500);
    }

    return (
        <div className="relative mt-3">
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 pr-10 font-mono text-[11px] leading-relaxed text-slate-100 dark:bg-slate-950 dark:ring-1 dark:ring-slate-800">
                {children}
            </pre>
            <button
                type="button"
                onClick={handle_copy}
                className="absolute right-2 top-2 rounded-md p-1 text-slate-400 hover:text-white"
                title="Copy to clipboard"
            >
                {copied
                    ? <Check className="h-3.5 w-3.5 text-green-400" />
                    : <Copy className="h-3.5 w-3.5" />}
            </button>
        </div>
    );
}

export function GettingStartedPanel({ hide_header = false }: { hide_header?: boolean } = {}) {
    const { default_realm_slug, default_org_slug } = useHubActivity();
    const has_default = default_realm_slug && default_org_slug;
    const realm_base = has_default ? `/o/${default_org_slug}/realms/${default_realm_slug}` : '/realms';
    const realm_path = realm_base;
    const daemons_path = has_default ? `${realm_base}/daemons` : '/realms';
    const teams_path = has_default ? `${realm_base}/teams` : '/teams';

    return (
        <div className="max-w-2xl">
            {!hide_header ? (
                <>
                    <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                            <Rocket className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                        </span>
                        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                            Getting started
                        </h1>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                        Install the CLI, connect to Hub, and run your first team in seven steps.
                    </p>
                </>
            ) : null}

            <ol className={`${hide_header ? '' : 'mt-8 '}space-y-4`}>
                <Step n={1} icon={Terminal} title="Install the CLI" hint="Open a terminal and install cliq.">
                    <Code>{`curl -fsSL https://getcliq.io/cliq/install | bash
cliq --version`}</Code>
                </Step>

                <Step n={2} icon={Settings} title="Run setup" hint="One-time wizard — configures agents, credentials, and your local environment.">
                    <Code>{`cliq setup`}</Code>
                    <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                        Run again any time with <code className="rounded bg-slate-100 px-1 dark:bg-slate-800 dark:text-slate-200">cliq setup --reset</code> to reconfigure.
                    </p>
                </Step>

                <Step n={3} icon={LogIn} title="Log in to CliqHub" hint="Connects your CLI to this Hub instance and enrolls your daemon on your default realm.">
                    <Code>{`cliq login`}</Code>
                </Step>

                <Step n={4} icon={Terminal} title="Start the daemon" hint="Launch the daemon process so it can connect to Hub.">
                    <Code>{`cliqd`}</Code>
                </Step>

                <Step n={5} icon={Monitor} title="See your daemon" hint="Come back to CliqHub — your daemon is now enrolled on your default realm.">
                    <div className="mt-3">
                        <Link
                            to={daemons_path}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                        >
                            {default_realm_slug ? `Open ${realm_qualified_label(default_org_slug, default_realm_slug)}` : 'View realms'}
                            <ArrowRight className="h-3 w-3" />
                        </Link>
                    </div>
                </Step>

                <Step n={6} icon={Package} title="Install a team" hint='Browse the available teams, find @cliq/hello-world and click "Install to Realm".'>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                            to="/teams"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                        >
                            Browse teams
                            <ArrowRight className="h-3 w-3" />
                        </Link>
                    </div>
                </Step>

                <Step n={7} icon={Play} title="Run the team" hint="Go to your realm's team list — hello-world should now be installed. Click Run.">
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                            to={teams_path}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                        >
                            {default_realm_slug ? `Open ${realm_qualified_label(default_org_slug, default_realm_slug)} teams` : 'View realm teams'}
                            <ArrowRight className="h-3 w-3" />
                        </Link>
                    </div>
                </Step>

                <li className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-5 dark:border-indigo-500/30 dark:bg-indigo-500/10">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">What's next</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        You're up and running. Here are some things to explore:
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                            to="/realms?create=1"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-500/50 dark:hover:text-indigo-200"
                        >
                            Create a realm
                        </Link>
                        <Link
                            to="/settings?tab=members"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-500/50 dark:hover:text-indigo-200"
                        >
                            Add users
                        </Link>
                        <Link
                            to="/builder"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-500/50 dark:hover:text-indigo-200"
                        >
                            Build a team
                        </Link>
                        <Link
                            to="/teams?tab=browse"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-500/50 dark:hover:text-indigo-200"
                        >
                            Browse teams
                        </Link>
                    </div>
                </li>
            </ol>
        </div>
    );
}
