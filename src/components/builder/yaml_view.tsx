import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useBuilder, useBuilderDispatch } from '@/lib/builder/store';
import { useTheme } from '@/lib/theme_context';
import { build_team_yml } from '@/lib/team_export';
import { parse_team_yml_text } from '@/lib/team_yml_parse';

import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting, bracketMatching, foldGutter } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { tags } from '@lezer/highlight';

/** Light theme — slate-50 background, indigo/emerald/amber syntax colors. */
const light_theme = EditorView.theme({
    '&': { height: '100%', maxHeight: '100%', fontSize: '11px', backgroundColor: '#f8fafc' },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
    '.cm-content': { minHeight: '0', caretColor: '#4f46e5' },
    '.cm-gutters': { fontSize: '10px', minHeight: '0', backgroundColor: '#f1f5f9', color: '#94a3b8', borderRight: '1px solid #e2e8f0' },
    '.cm-activeLineGutter': { backgroundColor: '#e2e8f0' },
    '.cm-activeLine': { backgroundColor: '#e0e7ff40' },
    '.cm-cursor': { borderLeftColor: '#4f46e5' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#c7d2fe' },
    '.cm-foldGutter': { color: '#94a3b8' },
}, { dark: false });

const light_highlight = HighlightStyle.define([
    { tag: tags.keyword, color: '#7c3aed' },
    { tag: tags.atom, color: '#7c3aed' },
    { tag: tags.bool, color: '#7c3aed' },
    { tag: tags.string, color: '#059669' },
    { tag: tags.number, color: '#d97706' },
    { tag: tags.comment, color: '#94a3b8', fontStyle: 'italic' },
    { tag: tags.propertyName, color: '#4338ca' },
    { tag: tags.variableName, color: '#4338ca' },
    { tag: tags.meta, color: '#6366f1' },
    { tag: tags.punctuation, color: '#64748b' },
    { tag: tags.operator, color: '#64748b' },
]);

/** Dark theme — slate-900 background, lighter indigo/emerald/amber syntax colors. */
const dark_theme = EditorView.theme({
    '&': { height: '100%', maxHeight: '100%', fontSize: '11px', backgroundColor: '#0f172a' },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
    '.cm-content': { minHeight: '0', caretColor: '#a5b4fc' },
    '.cm-gutters': { fontSize: '10px', minHeight: '0', backgroundColor: '#1e293b', color: '#64748b', borderRight: '1px solid #334155' },
    '.cm-activeLineGutter': { backgroundColor: '#334155' },
    '.cm-activeLine': { backgroundColor: '#1e1b4b40' },
    '.cm-cursor': { borderLeftColor: '#a5b4fc' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#3730a3' },
    '.cm-foldGutter': { color: '#64748b' },
}, { dark: true });

const dark_highlight = HighlightStyle.define([
    { tag: tags.keyword, color: '#c4b5fd' },
    { tag: tags.atom, color: '#c4b5fd' },
    { tag: tags.bool, color: '#c4b5fd' },
    { tag: tags.string, color: '#6ee7b7' },
    { tag: tags.number, color: '#fbbf24' },
    { tag: tags.comment, color: '#64748b', fontStyle: 'italic' },
    { tag: tags.propertyName, color: '#a5b4fc' },
    { tag: tags.variableName, color: '#a5b4fc' },
    { tag: tags.meta, color: '#818cf8' },
    { tag: tags.punctuation, color: '#94a3b8' },
    { tag: tags.operator, color: '#94a3b8' },
]);

export function YamlView() {
    const state = useBuilder();
    const dispatch = useBuilderDispatch();
    const { resolved: theme_mode } = useTheme();

    const serialized = useMemo(() => {
        if (!state.team) return '';
        return `${build_team_yml({
            name: state.team.name,
            description: state.team.description,
            tags: state.team.tags,
            inputs: state.team.inputs,
            use_when: state.team.use_when,
            not_for: state.team.not_for,
            phases: state.team.phases,
            roles: state.team.roles.map((role) => ({ name: role.name, content: role.content })),
            agents: state.team.agents,
        })}\n`;
    }, [state.team]);

    const [error, set_error] = useState<string | null>(null);
    const [warnings, set_warnings] = useState<string[]>([]);
    const [dirty, set_dirty] = useState(false);
    const [applying, set_applying] = useState(false);

    const editor_ref = useRef<HTMLDivElement>(null);
    const view_ref = useRef<EditorView | null>(null);
    const on_change_ref = useRef<(value: string) => void>(() => {});

    on_change_ref.current = useCallback(() => {
        set_dirty(true);
        set_error(null);
        set_warnings([]);
    }, []);

    function get_text(): string {
        if (!view_ref.current) return serialized;
        return view_ref.current.state.doc.toString();
    }

    function reset_editor() {
        if (!view_ref.current) return;
        const current = view_ref.current.state.doc.toString();
        if (current !== serialized) {
            view_ref.current.dispatch({
                changes: { from: 0, to: current.length, insert: serialized },
            });
        }
    }

    /** Create or recreate the editor (on mount and when theme changes). */
    useEffect(() => {
        if (!editor_ref.current) return;

        const prev_doc = view_ref.current?.state.doc.toString();
        if (view_ref.current) {
            view_ref.current.destroy();
            view_ref.current = null;
        }

        const is_dark = theme_mode === 'dark';
        const update_listener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                on_change_ref.current(update.state.doc.toString());
            }
        });

        const initial_state = EditorState.create({
            doc: prev_doc ?? serialized,
            extensions: [
                lineNumbers(),
                highlightActiveLine(),
                highlightActiveLineGutter(),
                history(),
                bracketMatching(),
                foldGutter(),
                yaml(),
                is_dark ? dark_theme : light_theme,
                syntaxHighlighting(is_dark ? dark_highlight : light_highlight),
                keymap.of([...defaultKeymap, ...historyKeymap]),
                update_listener,
            ],
        });

        const view = new EditorView({
            state: initial_state,
            parent: editor_ref.current,
        });

        view_ref.current = view;
        return () => { view.destroy(); view_ref.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [theme_mode]);

    /** Sync external serialized changes when team state updates (and editor is not dirty). */
    useEffect(() => {
        if (dirty) return;
        reset_editor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serialized]);

    async function handle_apply() {
        if (!state.team || applying) return;

        const text = get_text();
        const { team, error: parse_error } = parse_team_yml_text(text, state.team);
        if (parse_error) {
            set_error(parse_error);
            set_warnings([]);
            return;
        }

        set_applying(true);
        set_error(null);
        try {
            const res = await fetch('/v1/teams/build', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                body: JSON.stringify({ action: 'validate', team }),
            });
            const data = await res.json();
            if (!data.ok) {
                set_error(data.error?.message || 'Validation failed');
                return;
            }

            const validation = data.data as { valid: boolean; errors: string[]; warnings: string[] };
            dispatch({ type: 'SET_VALIDATION', validation });

            if (!validation.valid) {
                set_error(validation.errors.join(' · ') || 'YAML failed validation');
                set_warnings(validation.warnings ?? []);
                return;
            }

            dispatch({ type: 'UPDATE_TEAM', team });
            set_dirty(false);
            set_error(null);
            set_warnings(validation.warnings ?? []);
        } catch {
            set_error('Validation unavailable — fix network and try again');
        } finally {
            set_applying(false);
        }
    }

    function handle_reset() {
        reset_editor();
        set_dirty(false);
        set_error(null);
        set_warnings([]);
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-slate-900">
            {(dirty || error || warnings.length > 0) && (
                <div className={`flex items-start justify-between gap-2 border-b px-3 py-1.5 ${
                    error ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950' : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950'
                }`}>
                    <div className="min-w-0 flex-1">
                        <span className={`text-[11px] ${error ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                            {error || (dirty ? 'YAML has unsaved changes' : 'Valid with warnings')}
                        </span>
                        {warnings.length > 0 && !error ? (
                            <ul className="mt-0.5 list-disc pl-3 text-[10px] text-amber-700 dark:text-amber-300">
                                {warnings.slice(0, 5).map((warning) => (
                                    <li key={warning}>{warning}</li>
                                ))}
                            </ul>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                        <button
                            type="button"
                            onClick={handle_reset}
                            className="rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                        >
                            Reset
                        </button>
                        <button
                            type="button"
                            onClick={() => void handle_apply()}
                            disabled={applying || !dirty}
                            className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {applying ? 'Validating…' : 'Validate & Apply'}
                        </button>
                    </div>
                </div>
            )}
            <div ref={editor_ref} className="min-h-0 flex-1 overflow-hidden" />
        </div>
    );
}
