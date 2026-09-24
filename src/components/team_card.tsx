import { Link } from 'react-router';
import type { TeamListItem } from '@/lib/types';
import { Download } from 'lucide-react';

/** Format ISO date as "Mon DD" or "Mon DD, YYYY" if not current year. */
function format_short_date(iso: string): string {
    const d = new Date(iso);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    if (d.getFullYear() === now.getFullYear()) {
        return `${months[d.getMonth()]} ${d.getDate()}`;
    }
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Derive initials for the author avatar. */
function author_initials(author: string | null | undefined): string {
    if (!author) return '?';
    const parts = author.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return author.slice(0, 2).toUpperCase();
}

interface TeamCardProps {
    team: TeamListItem;
    compact?: boolean;
}

/** Marketplace team card — full or compact variant for trending rows. */
export function TeamCard({ team, compact = false }: TeamCardProps) {
    const scope_prefix = team.scope ? `@${team.scope}/` : '';
    const href = `/browse/${team.scope || '_'}/${team.name}`;

    if (compact) {
        return (
            <Link
                to={href}
                className="group block rounded-xl border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-md"
            >
                <h3 className="truncate text-sm font-bold text-slate-800 group-hover:text-indigo-600">
                    {scope_prefix}{team.name}
                </h3>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">
                    {team.description}
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                    <Download className="h-3 w-3" strokeWidth={2} />
                    <span>{team.install_count.toLocaleString()}</span>
                </div>
            </Link>
        );
    }

    return (
        <Link
            to={href}
            className="group relative flex flex-col rounded-xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lg"
        >
            {/* Top row: avatar + meta */}
            <div className="mb-3 flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-100 to-purple-100 text-xs font-bold text-indigo-600">
                    {author_initials(team.author)}
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-bold text-slate-900 group-hover:text-indigo-600">
                        {scope_prefix}{team.name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span className="font-semibold text-indigo-500">v{team.latest_version}</span>
                        {team.updated_at && (
                            <span>Updated {format_short_date(team.updated_at)}</span>
                        )}
                    </div>
                </div>
            </div>

            {/* Description */}
            <p className="mb-4 line-clamp-2 flex-1 text-sm leading-relaxed text-slate-500">
                {team.description}
            </p>

            {/* Footer: stats + badges */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                        <Download className="h-3.5 w-3.5" strokeWidth={2} />
                        {team.install_count.toLocaleString()}
                    </span>
                    {team.author && <span>by {team.author}</span>}
                </div>
                {team.has_agents && (
                    <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-600">
                        Agents
                    </span>
                )}
            </div>

            {/* Tags */}
            {team.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {team.tags.slice(0, 3).map((tag) => (
                        <span
                            key={tag}
                            className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200/60"
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            )}
        </Link>
    );
}
