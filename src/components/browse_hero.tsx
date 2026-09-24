import { Search } from 'lucide-react';

interface BrowseHeroProps {
    query: string;
    on_search: (query: string) => void;
}

/** Full-width gradient hero with large heading and centered search bar. */
export function BrowseHero({ query, on_search }: BrowseHeroProps) {
    function handle_submit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const form_data = new FormData(e.currentTarget);
        const raw = (form_data.get('q') as string || '').trim();
        on_search(raw);
    }

    return (
        <section className="relative overflow-hidden px-8 py-14 text-center">
            {/* Decorative background orbs */}
            <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-16 -right-16 h-48 w-48 rounded-full bg-purple-500/20 blur-3xl" />

            <div className="relative">
                <h1 className="mx-auto max-w-2xl text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
                    Find the perfect team for your workflow
                </h1>
                <p className="mx-auto mt-3 max-w-lg text-base text-indigo-200/80">
                    Discover, install, and run AI agent teams built by the community.
                </p>

                <form
                    onSubmit={handle_submit}
                    className="mx-auto mt-8 flex max-w-xl items-center gap-2 rounded-xl bg-white/10 p-1.5 backdrop-blur-sm ring-1 ring-white/20"
                >
                    <div className="flex flex-1 items-center gap-2 rounded-lg bg-white px-4 py-2.5">
                        <Search className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={2} />
                        <input
                            name="q"
                            defaultValue={query}
                            placeholder="Search teams, agents, workflows…"
                            className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                        />
                    </div>
                    <button
                        type="submit"
                        className="shrink-0 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
                    >
                        Search
                    </button>
                </form>
            </div>
        </section>
    );
}
