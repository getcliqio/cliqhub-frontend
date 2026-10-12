/**
 * A team's files, YAML first: the file list, an outline of `team.yml` (inputs, phases, other
 * top-level keys) that jumps to each part, and the file itself with line numbers, YAML
 * highlighting, a highlighted focus block (`focus` = a phase or input name), folding of list
 * items, wrap, Copy and Save.
 *
 * The outline is read from the text (line by line, no parsing), so it works on any version,
 * even one that doesn't parse.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Copy, Download } from 'lucide-react';

export interface Yaml_file { path: string; kind: 'yaml' | 'md'; content: string }

/** One named item in the outline (a phase or an input), with its 0-based line range. */
export interface Outline_item { name: string; start: number; end: number }
/** A top-level key of the YAML and, for lists like `phases:` / `inputs:`, its named items. */
export interface Outline_section { key: string; start: number; end: number; items: Outline_item[] }

const TOP_KEY = /^([A-Za-z0-9_.-]+):(\s|$)/;
const LIST_NAME = /^(\s*)-\s+name:\s*['"]?([^'"#\s][^'"#]*?)['"]?\s*(#.*)?$/;

/**
 * Outline of a YAML document: each top-level key with its line range, and under it each list
 * item that has a `name:` (phases, inputs, outputs…). Ranges end before the next item or key.
 */
export function yaml_outline(text: string): Outline_section[] {
	const lines = text.split('\n');
	const sections: Outline_section[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = TOP_KEY.exec(lines[i]);
		if (m) sections.push({ key: m[1], start: i, end: lines.length - 1, items: [] });
	}
	sections.forEach((s, k) => { if (sections[k + 1]) s.end = sections[k + 1].start - 1; });
	for (const s of sections) {
		let indent: number | null = null;
		for (let i = s.start + 1; i <= s.end; i++) {
			const m = LIST_NAME.exec(lines[i]);
			if (!m) continue;
			if (indent === null) indent = m[1].length;
			if (m[1].length !== indent) continue;
			s.items.push({ name: m[2].trim(), start: i, end: s.end });
		}
		s.items.forEach((it, k) => { if (s.items[k + 1]) it.end = s.items[k + 1].start - 1; });
		// Trailing blank lines belong to nothing.
		for (const it of s.items) while (it.end > it.start && !lines[it.end].trim()) it.end--;
	}
	return sections;
}

/** The outline item named `name` (a phase first, then any list), or null. */
export function find_item(outline: Outline_section[], name: string): Outline_item | null {
	const order = [...outline.filter((s) => s.key === 'phases'), ...outline.filter((s) => s.key !== 'phases')];
	for (const s of order) { const it = s.items.find((x) => x.name === name); if (it) return it; }
	return null;
}

/** Light YAML colouring for one line: comments, keys, and scalar values. */
export function highlight_yaml(line: string): ReactNode {
	const c = /^(\s*)(#.*)$/.exec(line);
	if (c) return <>{c[1]}<span className="text-[var(--g-ink-4)]">{c[2]}</span></>;
	const m = /^(\s*-?\s*)([A-Za-z0-9_.-]+)(:)(.*)$/.exec(line);
	if (!m) return line;
	const val = m[4];
	const cls = /^\s*(true|false|\d+(\.\d+)?)\s*$/.test(val) ? 'text-[var(--g-warn)]' : 'text-[var(--g-lime)]';
	return <>{m[1]}<span className="text-[var(--g-run-text)]">{m[2]}</span>{m[3]}<span className={cls}>{val}</span></>;
}

const CARD = 'rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]';
const SMALL = 'inline-flex items-center gap-1.5 rounded-md border border-[var(--g-line)] px-2 py-0.5 text-[12px] text-[var(--g-ink-2)] hover:bg-[var(--g-soft)]';
const LABEL = 'px-2.5 pb-1 pt-2 text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]';

export function Yaml_view({ files, selected, on_select, focus, on_focus, version, actions, on_copied }: {
	files: Yaml_file[];
	/** Path of the open file (default: the first, team.yml). */
	selected: string | null;
	on_select: (path: string) => void;
	/** Name of the phase / input to highlight and scroll to in team.yml. */
	focus: string | null;
	on_focus: (name: string | null) => void;
	/** Version shown in the header. */
	version: string | null;
	/** Extra controls under the file list (e.g. Edit in Builder). */
	actions?: ReactNode;
	on_copied?: (path: string) => void;
}) {
	const cur = files.find((f) => f.path === selected) ?? files[0] ?? null;
	const is_yaml = cur?.kind === 'yaml';
	const lines = useMemo(() => cur?.content.split('\n') ?? [], [cur]);
	const outline = useMemo(() => (is_yaml && cur ? yaml_outline(cur.content) : []), [is_yaml, cur]);
	const focused = focus && is_yaml ? find_item(outline, focus) : null;
	const [folded, set_folded] = useState<Set<number>>(new Set());
	const [wrap, set_wrap] = useState(false);
	const view = useRef<HTMLPreElement>(null);
	const roles = files.filter((f) => f.path.startsWith('roles/'));
	const top = files.filter((f) => !f.path.startsWith('roles/'));

	// A new file starts unfolded; jumping to an item unfolds it and scrolls it into view.
	useEffect(() => { set_folded(new Set()); }, [cur?.path]);
	useEffect(() => {
		if (!focused) return;
		set_folded((s) => { if (!s.has(focused.start)) return s; const n = new Set(s); n.delete(focused.start); return n; });
		const el = view.current?.querySelector(`[data-line="${focused.start}"]`) as HTMLElement | null;
		el?.scrollIntoView?.({ block: 'center' });
	}, [focused?.start, cur?.path]); // eslint-disable-line react-hooks/exhaustive-deps

	const foldable = new Map<number, Outline_item>();
	for (const s of outline) for (const it of s.items) if (it.end > it.start) foldable.set(it.start, it);
	const toggle_fold = (start: number) => set_folded((s) => { const n = new Set(s); if (n.has(start)) n.delete(start); else n.add(start); return n; });

	const rows: ReactNode[] = [];
	for (let i = 0; i < lines.length; i++) {
		const fold = foldable.get(i);
		const closed = fold && folded.has(i);
		const in_focus = focused && i >= focused.start && i <= focused.end;
		rows.push(
			<div key={i} data-line={i} className={`flex ${in_focus ? 'bg-[var(--g-acc-soft)]' : ''}`}>
				<span className="inline-flex w-[52px] shrink-0 select-none items-center justify-end gap-1 pr-3 text-right text-[var(--g-ink-4)]">
					{fold ? <button type="button" aria-label={`${closed ? 'Unfold' : 'Fold'} ${fold.name}`} aria-expanded={!closed} onClick={() => toggle_fold(i)} className="text-[10px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">{closed ? '▸' : '▾'}</button> : null}
					{i + 1}
				</span>
				<span className={`${wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'} min-w-0`}>{is_yaml ? highlight_yaml(lines[i]) : lines[i]}</span>
			</div>,
		);
		if (closed && fold) {
			rows.push(
				<div key={`f${i}`} className="flex text-[var(--g-ink-3)]">
					<span className="w-[52px] shrink-0" />
					<button type="button" onClick={() => toggle_fold(i)} className="italic hover:text-[var(--g-ink)]">… {fold.end - fold.start} more line{fold.end - fold.start === 1 ? '' : 's'}</button>
				</div>,
			);
			i = fold.end;
		}
	}

	const item_btn = (f: { path: string }) => (
		<button key={f.path} type="button" aria-current={cur?.path === f.path ? 'true' : undefined} onClick={() => on_select(f.path)}
			className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] g-mono ${cur?.path === f.path ? 'bg-[var(--g-soft)] text-[var(--g-ink)]' : 'text-[var(--g-ink-2)] hover:bg-[var(--g-soft)]'}`}>
			{f.path}
		</button>
	);

	return (
		<div className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)] gap-3.5" data-testid="yaml-view">
			<div className={`${CARD} self-start p-2`}>
				<p className={LABEL}>{version ? `v${version} · ` : ''}files</p>
				{top.map(item_btn)}
				{roles.length ? <p className={`${LABEL} pt-3`}>roles</p> : null}
				{roles.map(item_btn)}
				{!files.length ? <p className="px-2.5 py-3 text-[12px] text-[var(--g-ink-3)]">No files for this version.</p> : null}
				{outline.some((s) => s.items.length) ? (
					<nav aria-label="Outline" data-testid="yaml-outline" className="mt-3 border-t border-[var(--g-line)] pt-1">
						<p className={LABEL}>outline</p>
						{outline.filter((s) => s.items.length || ['name', 'description', 'version', 'review', 'outputs'].includes(s.key)).map((s) => (
							<div key={s.key} className="text-[12px]">
								<button type="button" onClick={() => { on_focus(null); view.current?.querySelector(`[data-line="${s.start}"]`)?.scrollIntoView?.({ block: 'start' }); }} className="block w-full rounded px-2.5 py-0.5 text-left text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">{s.key}</button>
								{s.items.map((it) => (
									<button key={`${s.key}/${it.name}`} type="button" aria-current={focused?.start === it.start ? 'true' : undefined} onClick={() => on_focus(it.name)}
										className={`g-mono block w-full truncate rounded py-0.5 pl-5 pr-2 text-left ${focused?.start === it.start ? 'bg-[var(--g-acc-soft)] text-[var(--g-acc)]' : 'text-[var(--g-ink-2)] hover:bg-[var(--g-soft)]'}`}>
										{it.name}
									</button>
								))}
							</div>
						))}
					</nav>
				) : null}
				{actions ? <div className="mt-3 grid gap-1.5 border-t border-[var(--g-line)] px-1 pt-3">{actions}</div> : null}
			</div>
			<div className={`${CARD} min-w-0 overflow-hidden`}>
				{cur ? (
					<>
						<div className="flex flex-wrap items-center gap-2 border-b border-[var(--g-line)] px-3.5 py-2">
							<span className="g-mono text-[13px]">{cur.path}</span>
							<span className="text-[12px] text-[var(--g-ink-3)]">{lines.length} lines{version ? ` · v${version}` : ''}</span>
							<span className="ml-auto flex items-center gap-1.5">
								{foldable.size ? <button type="button" onClick={() => set_folded(folded.size ? new Set() : new Set(foldable.keys()))} className={SMALL}>{folded.size ? 'Unfold all' : 'Fold all'}</button> : null}
								<button type="button" aria-pressed={wrap} onClick={() => set_wrap((w) => !w)} className={SMALL}>Wrap</button>
								<button type="button" onClick={() => { void navigator.clipboard?.writeText(cur.content); on_copied?.(cur.path); }} className={SMALL}><Copy aria-hidden className="h-3 w-3" />Copy</button>
								<a download={cur.path.split('/').pop()} href={`data:text/plain;charset=utf-8,${encodeURIComponent(cur.content)}`} className={SMALL}><Download aria-hidden className="h-3 w-3" />Save</a>
							</span>
						</div>
						<pre ref={view} className="g-mono max-h-[620px] overflow-auto py-3 text-[12px] leading-[1.7] text-[var(--g-ink-2)]" data-testid="file-view">{rows}</pre>
					</>
				) : <p className="px-4 py-6 text-[12.5px] text-[var(--g-ink-3)]">Nothing to show.</p>}
			</div>
		</div>
	);
}
