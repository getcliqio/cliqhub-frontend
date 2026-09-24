import type { TeamParam } from '@/lib/types';

interface MetadataCardProps {
    tags?: string[];
    use_when?: string[];
    not_for?: string[];
    inputs?: TeamParam[];
}

/** Renders team metadata (tags, use_when, not_for, inputs) for a team detail page. */
export function CapabilityCard({ tags, use_when, not_for, inputs }: MetadataCardProps) {
    const has_content = (tags?.length ?? 0) > 0
        || (use_when?.length ?? 0) > 0
        || (not_for?.length ?? 0) > 0
        || (inputs?.length ?? 0) > 0;

    if (!has_content) return null;

    return (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
            {tags && tags.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-1.5">
                    {tags.map((tag: string) => (
                        <span key={tag} className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">{tag}</span>
                    ))}
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                {use_when && use_when.length > 0 && (
                    <div>
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-600">Use When</p>
                        <ul className="space-y-1 text-xs text-emerald-700">
                            {use_when.map((item: string, i: number) => (
                                <li key={i} className="flex gap-1.5"><span className="shrink-0">&#x2022;</span>{item}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {not_for && not_for.length > 0 && (
                    <div>
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-600">Not For</p>
                        <ul className="space-y-1 text-xs text-emerald-700">
                            {not_for.map((item: string, i: number) => (
                                <li key={i} className="flex gap-1.5"><span className="shrink-0">&#x2022;</span>{item}</li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {inputs && inputs.length > 0 && (
                <div className="mt-4">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-600">Inputs</p>
                    <div className="space-y-1">
                        {inputs.map((p: TeamParam) => (
                            <div key={p.name} className="rounded-lg border border-emerald-200 bg-white px-3 py-2">
                                <code className="text-sm font-semibold text-slate-800">{p.name}</code>
                                {p.description && (
                                    <p className="mt-0.5 text-xs text-slate-600">{p.description}</p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
