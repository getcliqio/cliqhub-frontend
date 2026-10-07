/**
 * YAML view: team.yml (and each role brief) in CodeMirror, kept in sync with
 * the canvas. Typing parses as you go; pasting tidies to canonical team.yml
 * (unless the text has comments) with an Undo; problems show inline and in
 * the gutter; the cursor's phase is selected on the canvas and vice versa.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, bracketMatching, foldGutter, syntaxHighlighting } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import type { GeneratedTeam } from '@/lib/builder/store';
import type { Problem } from '@/lib/builder/checks';
import { format_yaml, parse_yaml, phase_at_line, phase_ranges, problem_line, team_to_yaml } from '@/lib/builder/yaml_tools';

const graphite_theme = EditorView.theme({
	'&': { height: '100%', fontSize: '12.5px', backgroundColor: 'var(--g-input)', color: 'var(--g-ink-2)' },
	'.cm-scroller': { overflow: 'auto', fontFamily: 'var(--g-mono)', lineHeight: '1.8' },
	'.cm-content': { caretColor: 'var(--g-acc)', padding: '10px 0' },
	'.cm-gutters': { backgroundColor: 'var(--g-input)', color: 'var(--g-ink-4)', border: 'none' },
	'.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--g-ink-3)' },
	'.cm-activeLine': { backgroundColor: 'var(--g-soft)' },
	'.cm-cursor': { borderLeftColor: 'var(--g-acc)' },
	'&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(155,140,255,.25)' },
	'.cm-foldGutter .cm-gutterElement': { color: 'var(--g-ink-4)' },
	'.gb-sel-line': { backgroundColor: 'rgba(155,140,255,.08)', boxShadow: 'inset 2px 0 0 #9b8cff' },
	'.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #ff5c5c', textUnderlineOffset: '3px' },
	'.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy #ffb224', textUnderlineOffset: '3px' },
	'.cm-tooltip': { backgroundColor: 'var(--g-pop)', border: '1px solid var(--g-line-strong)', color: 'var(--g-ink)' },
}, { dark: true });

const graphite_highlight = HighlightStyle.define([
	{ tag: tags.propertyName, color: 'var(--g-run-text)' },
	{ tag: tags.definition(tags.propertyName), color: 'var(--g-run-text)' },
	{ tag: tags.string, color: 'var(--g-lime)' },
	{ tag: tags.number, color: 'var(--g-warn-text)' },
	{ tag: tags.bool, color: 'var(--g-warn-text)' },
	{ tag: tags.keyword, color: 'var(--g-warn-text)' },
	{ tag: tags.atom, color: 'var(--g-warn-text)' },
	{ tag: tags.comment, color: 'var(--g-ink-4)', fontStyle: 'italic' },
	{ tag: tags.punctuation, color: 'var(--g-ink-4)' },
	{ tag: tags.heading, color: 'var(--g-ink)', fontWeight: '600' },
]);

const set_sel = StateEffect.define<{ from: number; to: number } | null>();
const sel_field = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		deco = deco.map(tr.changes);
		for (const e of tr.effects) if (e.is(set_sel)) {
			if (!e.value) return Decoration.none;
			const doc = tr.state.doc;
			const ranges = [];
			for (let l = e.value.from; l <= Math.min(e.value.to, doc.lines); l++) ranges.push(Decoration.line({ class: 'gb-sel-line' }).range(doc.line(l).from));
			return Decoration.set(ranges);
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

function base_extensions(lang: boolean, on_update: (v: EditorView, doc_changed: boolean, user: boolean) => void, on_paste?: (v: EditorView) => void): Extension[] {
	return [
		lineNumbers(), foldGutter(), highlightActiveLine(), highlightActiveLineGutter(), history(), bracketMatching(), lintGutter(),
		keymap.of([...defaultKeymap, ...historyKeymap]),
		...(lang ? [yaml()] : []),
		syntaxHighlighting(graphite_highlight), graphite_theme, sel_field, EditorView.lineWrapping,
		EditorView.updateListener.of((u) => { if (u.docChanged || u.selectionSet) on_update(u.view, u.docChanged, u.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete') || t.isUserEvent('undo') || t.isUserEvent('redo') || t.isUserEvent('select') || t.isUserEvent('move'))); }),
		...(on_paste ? [EditorView.domEventHandlers({ paste: (_e, v) => { window.setTimeout(() => on_paste(v), 0); return false; } })] : []),
	];
}

function replace_doc(v: EditorView, text: string) {
	const cur = v.state.doc.toString();
	if (cur !== text) v.dispatch({ changes: { from: 0, to: cur.length, insert: text } });
}

function to_diag(v: EditorView, line: number, message: string, severity: 'error' | 'warning'): Diagnostic {
	const l = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)));
	const first = l.text.search(/\S/);
	const colon = l.text.indexOf(': ');
	const from = l.from + (colon > 0 ? colon + 2 : Math.max(0, first));
	return { from: Math.min(from, l.to), to: l.to, severity, message };
}

export function Gb_yaml({ team, selected, problems, on_team, on_select, on_role }: {
	team: GeneratedTeam;
	selected: string | null;
	problems: Problem[];
	on_team: (t: GeneratedTeam) => void;
	on_select: (name: string | null) => void;
	on_role: (name: string, content: string) => void;
}) {
	const [tab, set_tab] = useState<string>('team.yml');
	const [parse_err, set_parse_err] = useState<{ message: string; line: number | null } | null>(null);
	const [note, set_note] = useState<{ text: string; undo?: string } | null>(null);
	const [pos, set_pos] = useState({ line: 1, col: 1 });
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView | null>(null);
	const emitted = useRef<string | null>(null);
	const timer = useRef<number | undefined>(undefined);
	const team_ref = useRef(team); team_ref.current = team;
	const sel_ref = useRef(selected); sel_ref.current = selected;
	const role_names = team.roles.map((r) => r.name);
	const is_yaml = tab === 'team.yml';
	const yaml_text = useMemo(() => team_to_yaml(team), [team]);

	function parse_now(v: EditorView) {
		const r = parse_yaml(v.state.doc.toString(), team_ref.current);
		if (!r.ok) { set_parse_err({ message: r.error, line: r.line }); return; }
		set_parse_err(null);
		emitted.current = JSON.stringify(r.team);
		if (JSON.stringify(r.team) !== JSON.stringify(team_ref.current)) on_team(r.team);
	}

	// (re)create the editor per tab
	useEffect(() => {
		if (!host.current) return;
		const doc = is_yaml ? team_to_yaml(team_ref.current) : team_ref.current.roles.find((r) => r.name === tab)?.content ?? '';
		const on_update = (v: EditorView, changed: boolean, user: boolean) => {
			const head = v.state.selection.main.head;
			const line = v.state.doc.lineAt(head);
			set_pos({ line: line.number, col: head - line.from + 1 });
			if (changed && user) {
				window.clearTimeout(timer.current);
				timer.current = window.setTimeout(() => {
					if (is_yaml) parse_now(v); else on_role(tab, v.state.doc.toString());
				}, 350);
			}
			if (is_yaml && !changed && user) {
				const name = phase_at_line(v.state.doc.toString(), line.number);
				if (name && name !== sel_ref.current) on_select(name);
			}
		};
		const on_paste = is_yaml ? (v: EditorView) => {
			const before = v.state.doc.toString();
			const f = format_yaml(before, team_ref.current);
			if (!f.ok) { set_parse_err({ message: f.error, line: f.line }); return; }
			set_parse_err(null);
			emitted.current = JSON.stringify(f.team);
			if (f.changed) { replace_doc(v, f.text); set_note({ text: 'Formatted on paste', undo: before }); }
			else if (f.kept_comments) set_note({ text: 'Kept as pasted — it has comments, so it wasn’t reformatted.' });
			on_team(f.team);
		} : undefined;
		const v = new EditorView({ state: EditorState.create({ doc, extensions: base_extensions(is_yaml, on_update, on_paste) }), parent: host.current });
		view.current = v;
		emitted.current = is_yaml ? JSON.stringify(team_ref.current) : null;
		return () => { window.clearTimeout(timer.current); v.destroy(); view.current = null; };
	}, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

	// canvas → editor (when the change didn't come from the editor)
	useEffect(() => {
		const v = view.current;
		if (!v || !is_yaml) return;
		if (emitted.current === JSON.stringify(team)) return;
		if (v.hasFocus && parse_err) return; // don't clobber text the user is fixing
		replace_doc(v, yaml_text);
		emitted.current = JSON.stringify(team);
	}, [team, yaml_text]); // eslint-disable-line react-hooks/exhaustive-deps

	// problems + parse errors → diagnostics
	useEffect(() => {
		const v = view.current;
		if (!v || !is_yaml) return;
		const text = v.state.doc.toString();
		const diags: Diagnostic[] = [];
		if (parse_err) diags.push(to_diag(v, parse_err.line ?? 1, parse_err.message, 'error'));
		else for (const p of problems) { const l = problem_line(text, p); if (l) diags.push(to_diag(v, l, p.message, p.level)); }
		v.dispatch(setDiagnostics(v.state, diags));
	}, [problems, parse_err, team, tab]); // eslint-disable-line react-hooks/exhaustive-deps

	// canvas selection → highlight + scroll
	useEffect(() => {
		const v = view.current;
		if (!v || !is_yaml) return;
		const r = selected ? phase_ranges(v.state.doc.toString()).get(selected) : null;
		v.dispatch({ effects: set_sel.of(r ?? null) });
		if (r && !v.hasFocus) { const at = v.state.doc.line(Math.min(r.from, v.state.doc.lines)).from; v.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'center' }) }); }
	}, [selected, tab, team]); // eslint-disable-line react-hooks/exhaustive-deps

	function format() {
		const v = view.current;
		if (!v) return;
		const before = v.state.doc.toString();
		const f = format_yaml(before, team_ref.current);
		if (!f.ok) { set_parse_err({ message: f.error, line: f.line }); return; }
		set_parse_err(null);
		if (f.kept_comments) { set_note({ text: 'Has comments — left as written.' }); return; }
		emitted.current = JSON.stringify(f.team);
		replace_doc(v, f.text);
		set_note(f.changed ? { text: 'Formatted', undo: before } : { text: 'Already tidy' });
		on_team(f.team);
	}

	const n_err = parse_err ? 1 : problems.filter((p) => p.level === 'error').length;
	const n_warn = parse_err ? 0 : problems.filter((p) => p.level === 'warning').length;

	return (
		<div className="flex h-full min-h-0 flex-col bg-[var(--g-input)]" data-testid="yaml-view">
			<div className="flex items-center gap-2 border-b border-[var(--g-line)] px-3 py-2">
				<div role="tablist" aria-label="Files" className="flex overflow-x-auto rounded-lg border border-[var(--g-line)]">
					{['team.yml', ...role_names].map((t) => (
						<button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => set_tab(t)} className={`g-mono whitespace-nowrap px-3 py-1 text-[12px] ${tab === t ? 'bg-[var(--g-soft)] text-[var(--g-ink)]' : 'text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>{t === 'team.yml' ? t : `roles/${t}.md`}</button>
					))}
				</div>
				{is_yaml ? <button type="button" onClick={format} className="ml-auto rounded-lg border border-[var(--g-line-strong)] bg-[var(--g-pop)] px-2.5 py-1 text-[12px] text-[var(--g-ink-2)]">Format</button> : <span className="ml-auto" />}
				<button type="button" onClick={() => { void navigator.clipboard?.writeText(view.current?.state.doc.toString() ?? ''); set_note({ text: 'Copied' }); }} className="rounded-lg border border-[var(--g-line-strong)] bg-[var(--g-pop)] px-2.5 py-1 text-[12px] text-[var(--g-ink-2)]">Copy</button>
			</div>
			{note ? (
				<div role="status" className="flex items-center gap-2 border-b border-[var(--g-line)] bg-[var(--g-acc-soft)] px-3 py-1.5 text-[12px] text-[var(--g-ink-2)]">
					<span>{note.text}</span>
					{note.undo !== undefined ? <button type="button" onClick={() => { const v = view.current; if (v && note.undo !== undefined) { replace_doc(v, note.undo); parse_now(v); } set_note(null); }} className="font-semibold text-[var(--g-acc)]">Undo</button> : null}
					<button type="button" aria-label="Dismiss" onClick={() => set_note(null)} className="ml-auto text-[var(--g-ink-3)]">✕</button>
				</div>
			) : null}
			<div ref={host} className="min-h-0 flex-1" data-testid="yaml-editor" />
			<div className="flex items-center gap-2 border-t border-[var(--g-line)] px-3 py-1.5 text-[11.5px]">
				{parse_err ? <span className="rounded-full bg-[var(--g-bad-soft)] px-2 font-semibold text-[var(--g-bad-text)]" data-testid="yaml-status">● Can’t read this YAML{parse_err.line ? ` (line ${parse_err.line})` : ''} — the canvas keeps the last good version</span>
					: <span className="rounded-full bg-[var(--g-ok-soft)] px-2 font-semibold text-[var(--g-ok)]" data-testid="yaml-status">✓ in sync with canvas</span>}
				{n_err ? <span className="text-[var(--g-bad-text)]">{n_err} error{n_err === 1 ? '' : 's'}</span> : null}
				{n_warn ? <span className="text-[var(--g-warn-text)]">{n_warn} warning{n_warn === 1 ? '' : 's'}</span> : null}
				<span className="ml-auto text-[var(--g-ink-3)]">Ln {pos.line}, Col {pos.col} · {is_yaml ? 'YAML' : 'Markdown'} · spaces: 2</span>
			</div>
		</div>
	);
}
