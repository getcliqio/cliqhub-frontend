import { useSearchParams } from 'react-router';
import { SortAsc, Tag } from 'lucide-react';

/**
 * Catalog orders → Core `teams/get` `sort_by` (Core API 6; the page maps them
 * in `teams_page.tsx`). `popular` is Core's default (most installed first).
 * Remove an id from CATALOG_SORTS to hide its button.
 */
const SORT_OPTIONS = [
    { id: 'popular', label: 'Most popular' },
    { id: 'recent', label: 'Recently updated' },
    { id: 'name', label: 'Name A–Z' },
];
const CATALOG_SORTS: ReadonlySet<string> = new Set(['popular', 'recent', 'name']);
const VISIBLE_SORTS = SORT_OPTIONS.filter((o) => CATALOG_SORTS.has(o.id));

const POPULAR_TAGS = [
    'code-review',
    'devops',
    'documentation',
    'testing',
    'security',
    'data',
];

/** Left sidebar for the Browse experience — sort and tags. */
export function BrowseSidebar() {
    const [params, set_params] = useSearchParams();
    const active_sort = params.get('sort') || 'popular';
    const active_tag = params.get('tag') || '';

    function set_param(key: string, value: string, default_value: string) {
        const next = new URLSearchParams(params);
        if (value === default_value) {
            next.delete(key);
        } else {
            next.set(key, value);
        }
        next.delete('offset');
        set_params(next, { replace: true });
    }

    return (
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-white/10 px-4 py-5 lg:block">
            {/* No category section: Core has no category field and its tags are free-form,
                so category buttons could not filter anything (see teams_page.tsx). */}
            {/* Sort — only when there is a real choice (see CATALOG_SORTS) */}
            {VISIBLE_SORTS.length > 1 ? (
            <section className="mb-6">
                <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-indigo-300/70">
                    <SortAsc className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Sort
                </h3>
                <nav className="space-y-0.5">
                    {VISIBLE_SORTS.map((opt) => (
                        <button
                            key={opt.id}
                            type="button"
                            onClick={() => set_param('sort', opt.id, 'popular')}
                            className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm font-medium transition ${
                                active_sort === opt.id
                                    ? 'bg-white/10 text-white'
                                    : 'text-indigo-200/80 hover:bg-white/5 hover:text-white'
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </nav>
            </section>
            ) : null}

            {/* Tags */}
            <section>
                <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-indigo-300/70">
                    <Tag className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Popular tags
                </h3>
                <div className="flex flex-wrap gap-1.5">
                    {POPULAR_TAGS.map((tag) => (
                        <button
                            key={tag}
                            type="button"
                            onClick={() => set_param('tag', active_tag === tag ? '' : tag, '')}
                            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                                active_tag === tag
                                    ? 'bg-indigo-400/30 text-white'
                                    : 'bg-white/10 text-indigo-200/80 hover:bg-white/15 hover:text-white'
                            }`}
                        >
                            {tag}
                        </button>
                    ))}
                </div>
            </section>
        </aside>
    );
}
