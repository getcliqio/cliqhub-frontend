import { useState, useCallback, useMemo } from 'react';
import { useBuilder, useBuilderDispatch, type GeneratedTeam } from '@/lib/builder/store';

function CopyIconButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
            title="Copy to clipboard"
        >
            {copied ? 'Copied!' : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
            )}
        </button>
    );
}

function StringListEditor({ label, items, onChange }: { label: string; items: string[]; onChange: (items: string[]) => void }) {
    const [editing, setEditing] = useState<number | null>(null);
    const [draft, setDraft] = useState('');

    function remove(index: number) {
        onChange(items.filter((_, i) => i !== index));
    }

    function open_editor(index: number) {
        setEditing(index);
        setDraft(items[index]);
    }

    function close_editor() {
        if (editing !== null) {
            const next = [...items];
            next[editing] = draft;
            onChange(next);
        }
        setEditing(null);
    }

    function add() {
        onChange([...items, '']);
        setEditing(items.length);
        setDraft('');
    }

    return (
        <div>
            <label className="mb-1 block text-[11px] font-bold text-slate-800">{label}</label>
            {items.length > 0 && (
                <div className="space-y-1">
                    {items.map((item, i) => (
                        <div key={i} className="flex items-start gap-1">
                            <button
                                onClick={() => open_editor(i)}
                                className="flex-1 rounded-md border border-slate-200 bg-indigo-50 px-2 py-1.5 text-left text-[11px] text-slate-900 transition hover:border-amber-300 hover:bg-amber-50"
                                title={item}
                            >
                                <span className={item ? 'line-clamp-2' : 'italic text-slate-400'}>
                                    {item || 'Click to edit...'}
                                </span>
                            </button>
                            <button
                                onClick={() => remove(i)}
                                className="shrink-0 px-1 pt-1.5 text-[11px] text-slate-400 hover:text-red-500"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            )}
            <button
                onClick={add}
                className="mt-1.5 w-full rounded-md border border-dashed border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition"
            >
                + Add
            </button>

            {editing !== null && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={close_editor}>
                    <div className="w-[440px] rounded-lg bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <label className="mb-1.5 block text-xs font-bold text-slate-700">{label} #{editing + 1}</label>
                        <textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            rows={6}
                            className="w-full resize-none rounded-md border border-slate-300 p-2.5 text-[11px] leading-relaxed text-slate-900 outline-none focus:border-indigo-400"
                            autoFocus
                        />
                        <div className="mt-2 flex justify-end gap-2">
                            <CopyIconButton text={draft} />
                            <button onClick={close_editor} className="rounded-md bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700">
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

interface ParamItem {
    name: string;
    description?: string;
}

function ParamListEditor({ label, items, onChange, unused_names }: { label: string; items: ParamItem[]; onChange: (items: ParamItem[]) => void; unused_names?: Set<string> }) {
    const [editing, setEditing] = useState<number | null>(null);

    function update(index: number, field: keyof ParamItem, value: string) {
        const next = [...items];
        next[index] = { ...next[index], [field]: value || undefined };
        if (field === 'name') next[index].name = value;
        onChange(next);
    }

    function remove(index: number) {
        if (editing === index) setEditing(null);
        onChange(items.filter((_, i) => i !== index));
    }

    function add() {
        onChange([...items, { name: '' }]);
        setEditing(items.length);
    }

    return (
        <div>
            <label className="mb-1 block text-[11px] font-bold text-slate-800">{label}</label>
            {items.length > 0 && (
                <div className="space-y-1.5">
                    {items.map((item, i) =>
                        editing === i ? (
                            <div key={i} className="rounded-md border-2 border-indigo-300 bg-white p-2.5 shadow-sm">
                                <div className="space-y-2">
                                    <div>
                                        <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Name</label>
                                        <input
                                            value={item.name}
                                            onChange={(e) => update(i, 'name', e.target.value)}
                                            placeholder="parameter name"
                                            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-900 outline-none focus:border-indigo-400"
                                            autoFocus
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Description</label>
                                        <textarea
                                            value={item.description || ''}
                                            onChange={(e) => update(i, 'description', e.target.value)}
                                            rows={2}
                                            placeholder="What this parameter represents (optional)"
                                            className="w-full resize-none rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] leading-relaxed text-slate-900 outline-none focus:border-indigo-400"
                                        />
                                    </div>
                                </div>
                                <div className="mt-2 flex items-center justify-between">
                                    <button onClick={() => remove(i)} className="text-[11px] text-red-500 hover:text-red-700">Remove</button>
                                    <button onClick={() => setEditing(null)} className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700">Done</button>
                                </div>
                            </div>
                        ) : (
                            <div
                                key={i}
                                onClick={() => setEditing(i)}
                                className="group cursor-pointer rounded-md border border-slate-200 bg-indigo-50 px-2 py-1.5 transition hover:border-amber-300 hover:bg-amber-50"
                                title={item.description || undefined}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="truncate font-mono text-[11px] font-bold text-slate-900">{item.name || 'unnamed'}</span>
                                        {item.name && unused_names?.has(item.name) && (
                                            <span
                                                className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700"
                                                title={`Not referenced — add $(inputs.${item.name}) to a role or phase field to use this input`}
                                            >
                                                unused
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span className="text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 transition">✎</span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); remove(i); }}
                                            className="text-[11px] text-slate-400 hover:text-red-500"
                                        >✕</button>
                                    </div>
                                </div>
                                {item.description && (
                                    <p className="mt-0.5 text-[11px] text-slate-600 line-clamp-1">{item.description}</p>
                                )}
                                {!item.description && !item.name && (
                                    <p className="mt-0.5 text-[11px] italic text-slate-400">Click to define...</p>
                                )}
                            </div>
                        ),
                    )}
                </div>
            )}
            <button
                onClick={add}
                className="mt-1.5 w-full rounded-md border border-dashed border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition"
            >
                + Add
            </button>
        </div>
    );
}

/** Editor panel for team name and flat metadata (tags, inputs, use_when, not_for). */
export function CapabilityEditor() {
    const state = useBuilder();
    const dispatch = useBuilderDispatch();
    const [tag_input, setTagInput] = useState('');

    const team = state.team;
    if (!team) return null;

    const update_team = useCallback(
        (partial: Partial<GeneratedTeam>) => {
            if (!state.team) return;
            dispatch({ type: 'UPDATE_TEAM', team: { ...state.team, ...partial } });
        },
        [state.team, dispatch],
    );

    /** Compute which declared inputs are not referenced in phases or roles. */
    const unused_inputs = useMemo(() => {
        if (!team) return new Set<string>();

        const referenced = new Set<string>();
        const re = /\$\(inputs\.(\w+)\)/g;

        for (const p of team.phases || []) {
            const fields: string[] = [];
            if (p.sources) for (const s of p.sources) { if (s.url) fields.push(s.url); if (s.name) fields.push(s.name); }
            if (p.target_entries) for (const t of p.target_entries) { if (t.file) fields.push(t.file); if (t.name) fields.push(t.name); }
            if (p.commands) for (const c of p.commands) { if (c.run) fields.push(c.run); }
            if (p.review?.reviewer) fields.push(p.review.reviewer);
            for (const f of fields) {
                let m;
                while ((m = re.exec(f)) !== null) referenced.add(m[1]);
            }
        }
        for (const role of team.roles || []) {
            if (role.content) {
                let m;
                while ((m = re.exec(role.content)) !== null) referenced.add(m[1]);
            }
        }

        const unused = new Set<string>();
        for (const inp of team.inputs || []) {
            if (inp.name && !referenced.has(inp.name)) unused.add(inp.name);
        }
        return unused;
    }, [team]);

    function handle_tag_keydown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const tag = tag_input.trim().replace(/,/g, '');
            if (!tag || !state.team) return;
            const current_tags = state.team.tags || [];
            if (!current_tags.includes(tag)) {
                update_team({ tags: [...current_tags, tag] });
            }
            setTagInput('');
        }
    }

    function remove_tag(tag: string) {
        if (!state.team) return;
        update_team({ tags: (state.team.tags || []).filter((t: string) => t !== tag) });
    }

    return (
        <div className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            <div className="flex h-10 items-center border-b border-slate-200 bg-slate-50 px-3 dark:border-slate-700 dark:bg-slate-800">
                <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">Metadata</h3>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {/* Tags */}
                <div>
                    <label className="mb-1 block text-xs font-bold text-slate-800">Tags</label>
                    {team.tags && team.tags.length > 0 && (
                        <div className="mb-1 flex flex-wrap gap-1">
                            {team.tags.map((tag: string) => (
                                <span
                                    key={tag}
                                    title={tag}
                                    className="flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700"
                                >
                                    {tag}
                                    <button
                                        onClick={() => remove_tag(tag)}
                                        className="text-slate-400 hover:text-red-500"
                                    >
                                        ✕
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                    <input
                        value={tag_input}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={handle_tag_keydown}
                        placeholder="Add tag (Enter or comma)"
                        className="w-full rounded-lg border border-slate-300 bg-indigo-50 px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:bg-white"
                    />
                </div>

                {/* Inputs */}
                <ParamListEditor
                    label="Inputs"
                    items={(team.inputs || []) as ParamItem[]}
                    onChange={(items) => update_team({ inputs: items })}
                    unused_names={unused_inputs}
                />

                {/* Use When */}
                <StringListEditor
                    label="Use When"
                    items={team.use_when || []}
                    onChange={(items) => update_team({ use_when: items })}
                />

                {/* Not For */}
                <StringListEditor
                    label="Not For"
                    items={team.not_for || []}
                    onChange={(items) => update_team({ not_for: items })}
                />
            </div>
        </div>
    );
}
