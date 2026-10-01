/**
 * Builder canvas. The layout is never stored: step = longest depends_on path,
 * order within a step = team.yml order (see graph_ops.builder_layout).
 *
 * Three gestures:
 *   1. drag a tile from the palette (drop on an arrow = insert, on a phase =
 *      add after it, on empty canvas = new branch) — or click a tile;
 *   2. drag from a phase's bottom dot onto another phase = "runs after";
 *   3. click to edit. Dragging a phase sideways within its row reorders it.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { GeneratedTeam } from '@/lib/builder/store';
import { KINDS, PALETTE, kind_of, type Kind_id } from '@/lib/builder/kinds';
import { add_after, add_root, builder_layout, connect, disconnect, insert_between, move_within_step, type Op_result } from '@/lib/builder/graph_ops';

export const KIND_MIME = 'application/x-cliq-kind';
const W = 210;
const H = 62;
const COL = 240;
const ROW = 128;
const TOP = 118;
const PAD = 130;

type Drop_target = { type: 'after'; name: string } | { type: 'between'; from: string; to: string } | { type: 'root' } | null;

function hexa(hex: string, a: number) {
	const n = Number.parseInt(hex.slice(1), 16);
	return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

export function Kind_tile({ kind, size = 28 }: { kind: Kind_id; size?: number }) {
	const k = KINDS[kind];
	return (
		<span aria-hidden className="grid shrink-0 place-items-center rounded-lg font-bold" style={{ width: size, height: size, fontSize: size * 0.48, color: k.color, background: hexa(k.color, 0.14), border: `1px solid ${hexa(k.color, 0.35)}` }}>{k.glyph}</span>
	);
}

export function Kind_menu({ label, on_pick, on_close }: { label: string; on_pick: (k: Kind_id) => void; on_close: () => void }) {
	return (
		<div role="menu" aria-label={label} className="z-30 w-[220px] rounded-[10px] border border-[#33363c] bg-[#16171a] p-1.5 shadow-[0_20px_50px_rgba(0,0,0,.6)]" onPointerDown={(e) => e.stopPropagation()}>
			<p className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]">{label}</p>
			{PALETTE.map((k) => (
				<button key={k} type="button" role="menuitem" onClick={() => { on_pick(k); on_close(); }} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-[var(--g-soft)]">
					<Kind_tile kind={k} size={20} />{KINDS[k].label}
				</button>
			))}
			<button type="button" onClick={on_close} className="mt-1 w-full rounded-md px-2 py-1 text-left text-[11.5px] text-[var(--g-ink-3)] hover:bg-[var(--g-soft)]">Cancel</button>
		</div>
	);
}

function subtitle(team: GeneratedTeam, name: string): string {
	const p = team.phases.find((x) => x.name === name)!;
	const k = kind_of(p);
	if (k === 'gate') return `${p.commands?.length ?? 0} check${p.commands?.length === 1 ? '' : 's'}${p.max_iterations ? ` · ≤${p.max_iterations}` : ''}`;
	if (k === 'human') return p.review?.reviewer ? `reviewer · ${p.review.reviewer}` : 'reviewer not set';
	if (k === 'script') return `${p.commands?.length ?? 0} command${p.commands?.length === 1 ? '' : 's'}`;
	if (k === 'connector') return `${p.agent}${p.action ? ` · ${p.action}` : ''}`;
	if (k === 'fetch') return `${(p.sources?.length ?? 0) + (p.target_entries?.length ?? 0)} URL${(p.sources?.length ?? 0) + (p.target_entries?.length ?? 0) === 1 ? '' : 's'}`;
	if (k === 'team') return p.team || 'team not set';
	return p.agent ?? 'agent';
}

export interface Canvas_preview { team: GeneratedTeam; added: Set<string>; changed: Set<string>; removed: string[] }

export function Gb_canvas({
	team, selected, problems, on_select, on_change, on_inputs, preview = null,
}: {
	team: GeneratedTeam;
	selected: string | null;
	/** phase → worst problem level */
	problems: Map<string, 'error' | 'warning'>;
	on_select: (name: string | null) => void;
	/** A structural edit; `select` is the phase to select afterwards. */
	on_change: (next: GeneratedTeam, select?: string | null) => void;
	on_inputs: () => void;
	preview?: Canvas_preview | null;
}) {
	const shown = preview?.team ?? team;
	const L = useMemo(() => builder_layout(shown), [shown]);
	const [zoom, set_zoom] = useState(1);
	const [toast, set_toast] = useState<string | null>(null);
	const [hover_edge, set_hover_edge] = useState<string | null>(null);
	const [menu, set_menu] = useState<{ kind: 'after'; name: string; x: number; y: number } | { kind: 'between'; from: string; to: string; x: number; y: number } | { kind: 'root'; x: number; y: number } | null>(null);
	const [wire, set_wire] = useState<{ from: string; x: number; y: number } | null>(null);
	const [drag, set_drag] = useState<{ name: string; dx: number } | null>(null);
	const [drop, set_drop] = useState<Drop_target>(null);
	const wrap = useRef<HTMLDivElement>(null);
	const inner = useRef<HTMLDivElement>(null);
	const locked = Boolean(preview);

	const content_w = Math.max(560, Math.max(L.widest, 1) * COL + PAD * 2);
	const content_h = TOP + Math.max(L.steps, 1) * ROW + (L.support.length ? 120 : 70);
	const at = (name: string) => {
		const p = L.pos.get(name)!;
		return { x: content_w / 2 + p.slot * COL - W / 2, y: TOP + p.step * ROW };
	};
	// Keep the flow centred when it's wider than the viewport.
	useEffect(() => {
		const el = wrap.current;
		if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
	}, [content_w, zoom]);
	const main = shown.phases.filter((p) => !p.is_support && L.pos.has(p.name));
	const leaves = main.filter((p) => !main.some((q) => q.depends_on.includes(p.name)));
	const edges = main.flatMap((p) => p.depends_on.filter((d) => L.pos.has(d)).map((d) => ({ from: d, to: p.name })));

	function flash(msg: string) { set_toast(msg); window.setTimeout(() => set_toast((t) => (t === msg ? null : t)), 3200); }
	function apply(r: Op_result) {
		if (!r.ok) { flash(r.error); return; }
		on_change(r.team, r.name ?? undefined);
	}
	function to_content(clientX: number, clientY: number) {
		const r = inner.current!.getBoundingClientRect();
		return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom };
	}
	function node_at(clientX: number, clientY: number): string | null {
		const el = document.elementFromPoint?.(clientX, clientY) as HTMLElement | null;
		return el?.closest<HTMLElement>('[data-node]')?.dataset.node ?? null;
	}
	function edge_near(x: number, y: number): { from: string; to: string } | null {
		let best: { from: string; to: string } | null = null; let dist = 46;
		for (const e of edges) {
			const a = at(e.from); const b = at(e.to);
			const mx = (a.x + b.x) / 2 + W / 2; const my = (a.y + H + b.y) / 2;
			const d = Math.hypot(mx - x, my - y);
			if (d < dist) { dist = d; best = e; }
		}
		return best;
	}

	// ── palette drop ──
	function on_drag_over(e: DragEvent) {
		if (locked || !e.dataTransfer.types.includes(KIND_MIME)) return;
		e.preventDefault();
		set_drop(target_at(e.clientX, e.clientY));
	}
	function target_at(x: number, y: number): Drop_target {
		const n = node_at(x, y);
		if (n) return { type: 'after', name: n };
		const c = to_content(x, y);
		const ed = edge_near(c.x, c.y);
		return ed ? { type: 'between', ...ed } : { type: 'root' };
	}
	function on_drop(e: DragEvent) {
		const kind = e.dataTransfer.getData(KIND_MIME) as Kind_id;
		e.preventDefault();
		const t = drop ?? target_at(e.clientX, e.clientY);
		set_drop(null);
		if (!kind || !KINDS[kind] || !t) return;
		if (t.type === 'after') apply(add_after(team, kind, t.name));
		else if (t.type === 'between') apply(insert_between(team, kind, t.from, t.to));
		else apply(add_root(team, kind));
	}

	// ── wiring ──
	function start_wire(e: RPointerEvent, from: string) {
		if (locked) return;
		e.stopPropagation(); e.preventDefault();
		const c = to_content(e.clientX, e.clientY);
		set_wire({ from, ...c });
		const move = (ev: PointerEvent) => { const p = to_content(ev.clientX, ev.clientY); set_wire({ from, ...p }); };
		const up = (ev: PointerEvent) => {
			window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
			set_wire(null);
			const to = node_at(ev.clientX, ev.clientY);
			if (to && to !== from) apply(connect(team, from, to));
		};
		window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
	}

	// ── reorder within a row ──
	function start_drag(e: RPointerEvent, name: string) {
		if (locked || e.button !== 0) return;
		const sx = e.clientX; let moved = false;
		const move = (ev: PointerEvent) => {
			const dx = ev.clientX - sx;
			if (!moved && Math.abs(dx) < 6) return;
			moved = true;
			set_drag({ name, dx: dx / zoom });
		};
		const up = (ev: PointerEvent) => {
			window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
			set_drag(null);
			if (!moved) return;
			const target = node_at(ev.clientX, ev.clientY);
			if (!target || target === name) return;
			const tc = at(target);
			const px = to_content(ev.clientX, ev.clientY).x;
			apply(move_within_step(team, name, target, px < tc.x + W / 2 ? 'before' : 'after'));
		};
		window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
	}

	function pick(k: Kind_id) {
		if (!menu) return;
		if (menu.kind === 'after') apply(add_after(team, k, menu.name));
		else if (menu.kind === 'between') apply(insert_between(team, k, menu.from, menu.to));
		else apply(add_root(team, k));
	}

	// ── drawing ──
	const defs: ReactNode[] = [];
	const paths: ReactNode[] = [];
	edges.forEach((e, i) => {
		const a = at(e.from); const b = at(e.to);
		const pa = shown.phases.find((p) => p.name === e.from)!; const pb = shown.phases.find((p) => p.name === e.to)!;
		const ca = KINDS[kind_of(pa)].color; const cb = KINDS[kind_of(pb)].color;
		const x1 = a.x + W / 2; const y1 = a.y + H; const x2 = b.x + W / 2; const y2 = b.y - 3;
		const dy = Math.max(34, (y2 - y1) * 0.5);
		const d = `M${x1} ${y1} C${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
		const id = `ge${i}`; const key = `${e.from}>${e.to}`;
		const is_new = Boolean(preview && (preview.added.has(e.to) || preview.added.has(e.from)));
		defs.push(<linearGradient key={id} id={id} gradientUnits="userSpaceOnUse" x1="0" y1={y1} x2="0" y2={y2}><stop offset="0" stopColor={ca} stopOpacity={0.8} /><stop offset="1" stopColor={cb} stopOpacity={0.8} /></linearGradient>);
		paths.push(
			<g key={key} data-edge={key} onMouseEnter={() => set_hover_edge(key)}>
				<path d={d} stroke="transparent" strokeWidth={22} fill="none" />
				{is_new ? <path d={d} stroke="#3ecf8e" strokeWidth={1.7} strokeDasharray="5 4" fill="none" /> : <>
					<path d={d} stroke={ca} strokeOpacity={hover_edge === key ? 0.28 : 0.1} strokeWidth={7} fill="none" />
					<path d={d} stroke={`url(#${id})`} strokeWidth={1.7} fill="none" />
					<circle className="g-flow" r={2.6} fill="#fff" opacity={0.9}><animateMotion dur="2.4s" repeatCount="indefinite" begin={`-${(i * 0.6) % 2.4}s`} path={d} /></circle>
				</>}
				<path d={`M${x2 - 4} ${y2 - 6} L${x2} ${y2} L${x2 + 4} ${y2 - 6}`} stroke={is_new ? '#3ecf8e' : cb} strokeWidth={1.7} fill="none" strokeLinecap="round" />
			</g>,
		);
	});
	// gate route-back arcs
	for (const p of main) {
		if (kind_of(p) !== 'gate' || !p.max_iterations) continue;
		const target = p.depends_on.find((d) => L.pos.has(d) && kind_of(shown.phases.find((x) => x.name === d)!) === 'agent') ?? p.depends_on.find((d) => L.pos.has(d));
		if (!target) continue;
		const g = at(p.name); const t = at(target);
		const gy = g.y + H / 2; const ty = t.y + H / 2; const left = Math.min(g.x, t.x) - 64;
		paths.push(
			<g key={`loop-${p.name}`} data-loop={`${p.name}->${target}`}>
				<path className="g-march" d={`M${g.x - 2} ${gy} C${left} ${gy}, ${left} ${ty}, ${t.x - 3} ${ty}`} stroke="#f5a524" strokeWidth={1.5} strokeDasharray="5 5" fill="none" style={{ animation: 'g-march 1.2s linear infinite' }} />
				<path d={`M${t.x - 10} ${ty - 4} L${t.x - 3} ${ty} L${t.x - 10} ${ty + 4}`} stroke="#f5a524" strokeWidth={1.6} fill="none" strokeLinecap="round" />
				<g transform={`translate(${left - 44},${(gy + ty) / 2 - 11})`}><rect width={96} height={22} rx={11} fill="#221a0b" stroke="#f5a524" strokeOpacity={0.55} /><text x={48} y={15} textAnchor="middle" fontSize={10.5} fill="#ffc766" fontWeight={600} fontFamily="var(--g-font)">↺ route · ≤ {p.max_iterations}</text></g>
			</g>,
		);
	}
	const hover = hover_edge ? edges.find((e) => `${e.from}>${e.to}` === hover_edge) : null;
	const hover_mid = hover ? (() => { const a = at(hover.from); const b = at(hover.to); return { x: (a.x + b.x) / 2 + W / 2, y: (a.y + H + b.y) / 2 }; })() : null;
	const drop_mid = drop?.type === 'between' ? (() => { const a = at(drop.from); const b = at(drop.to); return { x: (a.x + b.x) / 2 + W / 2, y: (a.y + H + b.y) / 2 }; })() : null;
	const inputs = shown.inputs ?? [];

	return (
		<div className="relative h-full min-h-0 bg-[#0b0c0e]" data-testid="canvas">
		<div className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'radial-gradient(#1d2024 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
		<div ref={wrap} className="relative h-full overflow-auto" onPointerDown={() => { set_menu(null); }}>
			<div
				ref={inner}
				className="relative mx-auto"
				style={{ width: content_w, height: content_h, transform: `scale(${zoom})`, transformOrigin: 'top center' }}
				onDragOver={on_drag_over}
				onDragLeave={() => set_drop(null)}
				onDrop={on_drop}
				onClick={(e) => { if (e.target === e.currentTarget && !locked) on_select(null); }}
				role="application"
				aria-label="Workflow canvas"
			>
				<svg width={content_w} height={content_h} className="absolute left-0 top-0" style={{ pointerEvents: 'none' }}>
					<defs>
						<radialGradient id="gb-aura" cx="50%" cy="45%" r="60%"><stop offset="0" stopColor="#7c6cff" stopOpacity={0.1} /><stop offset="1" stopColor="#7c6cff" stopOpacity={0} /></radialGradient>
						{defs}
					</defs>
					<style>{'@media (prefers-reduced-motion: reduce){.g-flow{display:none}.g-march{animation:none!important}}'}</style>
					<ellipse cx={content_w / 2} cy={content_h * 0.45} rx={content_w * 0.5} ry={content_h * 0.5} fill="url(#gb-aura)" />
					{/* inputs → roots */}
					{main.filter((p) => !p.depends_on.some((d) => L.pos.has(d))).map((p) => { const b = at(p.name); return <path key={`in-${p.name}`} d={`M${content_w / 2} 84 C${content_w / 2} 100, ${b.x + W / 2} ${b.y - 26}, ${b.x + W / 2} ${b.y - 3}`} stroke="#3a3d44" strokeWidth={1.4} strokeDasharray="3 4" fill="none" />; })}
					<g style={{ pointerEvents: 'auto' }}>{paths}</g>
					{wire ? (() => { const a = at(wire.from); const x1 = a.x + W / 2; const y1 = a.y + H; return <path d={`M${x1} ${y1} C${x1} ${y1 + 60}, ${wire.x} ${wire.y - 60}, ${wire.x} ${wire.y}`} stroke="#d4ff3f" strokeWidth={2} strokeDasharray="6 5" fill="none" data-testid="wire" />; })() : null}
				</svg>

				{/* run inputs */}
				<button type="button" onClick={(e) => { e.stopPropagation(); on_inputs(); }} data-testid="inputs-node" className="absolute rounded-[14px] border-[1.5px] border-[rgba(212,255,63,.5)] bg-[linear-gradient(180deg,#171a10,#121316)] px-3 py-2 text-left shadow-[0_0_0_4px_rgba(212,255,63,.07)]" style={{ left: content_w / 2 - 160, top: 22, width: 320 }}>
					<span className="flex items-center gap-2 text-[12.5px] font-semibold"><span aria-hidden className="grid h-[18px] w-[18px] place-items-center rounded-full border-2 border-[var(--g-acc)]"><i className="block h-1.5 w-1.5 rounded-full bg-[var(--g-acc)]" /></span>Run inputs<span className="ml-auto text-[11px] font-normal text-[var(--g-ink-3)]">click to edit</span></span>
					<span className="mt-1.5 flex flex-wrap gap-1">{inputs.length ? inputs.map((i) => <span key={i.name} className="g-mono rounded-md border border-[var(--g-line)] bg-[var(--g-soft)] px-1.5 text-[11px]">{i.name}</span>) : <span className="text-[11.5px] text-[var(--g-ink-3)]">none — runs start straight away</span>}</span>
				</button>

				{!main.length ? (
					<div className={`absolute grid place-items-center rounded-2xl border-2 border-dashed text-center ${drop ? 'border-[var(--g-acc)] bg-[rgba(212,255,63,.05)]' : 'border-[#2c2f35]'}`} style={{ left: content_w / 2 - 230, top: TOP + 10, width: 460, height: 200 }}>
						<div>
							<p className="text-[14px] font-semibold">Drag a phase here to start</p>
							<p className="mt-1 text-[12.5px] text-[var(--g-ink-3)]">or click a tile on the left, or ask AI on the right tab</p>
							{!locked ? <button type="button" onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const c = to_content(r.left, r.bottom); set_menu({ kind: 'root', x: c.x, y: c.y + 6 }); }} className="mt-3 rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-acc)]">+ Add the first phase</button> : null}
						</div>
					</div>
				) : null}

				{main.map((p) => {
					const { x, y } = at(p.name);
					const kind = kind_of(p); const k = KINDS[kind];
					const sel = selected === p.name && !locked;
					const prob = problems.get(p.name);
					const mark = preview?.added.has(p.name) ? 'new' : preview?.changed.has(p.name) ? 'changed' : null;
					const is_drop = drop?.type === 'after' && drop.name === p.name;
					const dx = drag?.name === p.name ? drag.dx : 0;
					return (
						<div
							key={p.name}
							data-node={p.name}
							role="button"
							tabIndex={0}
							aria-pressed={sel}
							aria-label={`${p.name}, ${k.label}${prob ? `, has ${prob}s` : ''}`}
							onClick={(e) => { e.stopPropagation(); if (!locked) on_select(p.name); }}
							onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); on_select(p.name); } }}
							onPointerDown={(e) => start_drag(e, p.name)}
							className="group absolute cursor-pointer select-none rounded-xl outline-none"
							style={{ left: x + dx, top: y, width: W, height: H, zIndex: dx ? 20 : 2, transition: dx ? 'none' : 'left .25s ease, top .25s ease' }}
						>
							<div className="relative flex h-full items-center gap-2.5 rounded-xl px-3" style={{
								background: 'linear-gradient(180deg,#1c1e23,#131417)',
								border: `${sel || mark || is_drop ? 1.5 : 1}px ${mark === 'new' ? 'dashed' : 'solid'} ${mark === 'new' ? '#3ecf8e' : mark === 'changed' ? '#f5a524' : is_drop ? '#d4ff3f' : sel ? k.color : hexa(k.color, 0.38)}`,
								boxShadow: sel ? `0 0 0 4px ${hexa(k.color, 0.14)}, 0 0 24px ${hexa(k.color, 0.35)}` : '0 8px 18px rgba(0,0,0,.5)',
							}}>
								<Kind_tile kind={kind} />
								<span className="min-w-0 flex-1">
									<span className="block truncate text-[13px] font-semibold text-[var(--g-ink)]">{p.name}</span>
									<span className="g-mono block truncate text-[10.5px] text-[var(--g-ink-3)]">{subtitle(shown, p.name)}</span>
								</span>
								{prob ? <span title={prob === 'error' ? 'Has problems' : 'Has warnings'} className="h-2 w-2 shrink-0 rounded-full" style={{ background: prob === 'error' ? 'var(--g-bad)' : 'var(--g-warn)' }} data-testid={`problem-${p.name}`} /> : null}
								{kind === 'gate' && p.max_iterations ? <span className="g-mono absolute -top-2.5 right-3 rounded-full border border-[rgba(245,165,36,.6)] bg-[#221a0b] px-2 text-[10px] font-bold text-[#ffc766]">×{p.max_iterations}</span> : null}
								{mark ? <span className={`absolute -left-2 -top-2.5 rounded-full border px-2 text-[9.5px] font-bold ${mark === 'new' ? 'border-[#3ecf8e] bg-[#0f2a1f] text-[#3ecf8e]' : 'border-[#f5a524] bg-[#221a0b] text-[#ffc766]'}`}>{mark === 'new' ? 'NEW' : 'CHANGED'}</span> : null}
							</div>
							{!locked ? (
								<span
									role="button"
									aria-label={`Connect ${p.name} to a phase that runs after it`}
									title="Drag onto a phase that should run after this one"
									onPointerDown={(e) => start_wire(e, p.name)}
									className={`absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-[1.5px] bg-[#0b0c0e] ${sel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
									style={{ borderColor: k.color }}
									data-testid={`handle-${p.name}`}
								/>
							) : null}
						</div>
					);
				})}

				{/* + under leaves */}
				{!locked ? leaves.map((p) => { const { x, y } = at(p.name); return (
					<button key={`plus-${p.name}`} type="button" aria-label={`Add a phase after ${p.name}`} onClick={(e) => { e.stopPropagation(); set_menu({ kind: 'after', name: p.name, x: x + W / 2 - 110, y: y + H + 44 }); }} className="absolute grid h-7 w-7 place-items-center rounded-full border border-dashed border-[#3a3d44] bg-[#16171a] text-[15px] text-[var(--g-ink-3)] hover:border-[var(--g-acc)] hover:text-[var(--g-acc)]" style={{ left: x + W / 2 - 14, top: y + H + 14 }}>+</button>
				); }) : null}

				{/* hovered arrow: insert / remove */}
				{hover && hover_mid && !locked ? (
					<span className="absolute z-10 flex gap-1" style={{ left: hover_mid.x - 44, top: hover_mid.y - 12 }} onMouseLeave={() => set_hover_edge(null)}>
						<button type="button" aria-label={`Insert a phase between ${hover.from} and ${hover.to}`} onClick={(e) => { e.stopPropagation(); set_menu({ kind: 'between', from: hover.from, to: hover.to, x: hover_mid.x - 110, y: hover_mid.y + 16 }); }} className="h-6 rounded-full border border-[#3a3d44] bg-[#16171a] px-2.5 text-[11px] text-[var(--g-ink)]">+ insert</button>
						<button type="button" aria-label={`Remove link ${hover.from} → ${hover.to}`} onClick={(e) => { e.stopPropagation(); set_hover_edge(null); apply(disconnect(team, hover.from, hover.to)); }} className="h-6 rounded-full border border-[rgba(255,92,92,.6)] bg-[#2a1414] px-2 text-[11px] text-[#ff8b8b]">✕</button>
					</span>
				) : null}
				{drop_mid ? <span className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border-[1.5px] border-dashed border-[#d4ff3f] bg-[rgba(212,255,63,.08)] px-3 py-1 text-[11.5px] text-[#d4ff3f]" style={{ left: drop_mid.x - 90, top: drop_mid.y - 14 }}>insert here</span> : null}
				{menu ? <div className="absolute z-30" style={{ left: menu.x, top: menu.y }}><Kind_menu label={menu.kind === 'after' ? `Add after ${menu.name}` : menu.kind === 'between' ? `Insert between ${menu.from} → ${menu.to}` : 'Add a phase'} on_pick={pick} on_close={() => set_menu(null)} /></div> : null}

				{/* support shelf */}
				{L.support.length ? (
					<div className="absolute flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[#2c2f35] px-3 py-2 text-[11.5px] text-[var(--g-ink-3)]" style={{ left: content_w / 2 - 260, top: TOP + Math.max(L.steps, 1) * ROW + 16, width: 520 }}>
						<span>Support · callable by any phase:</span>
						{L.support.map((n) => <button key={n} type="button" data-node={n} onClick={(e) => { e.stopPropagation(); if (!locked) on_select(n); }} className={`g-mono rounded-md border px-2 py-0.5 text-[11.5px] ${selected === n ? 'border-[var(--g-acc-line)] text-[var(--g-ink)]' : 'border-[var(--g-line)] bg-[var(--g-soft)] text-[var(--g-ink-2)]'}`}>{n}</button>)}
					</div>
				) : null}
			</div>
		</div>

			{/* floating controls */}
			<div className="absolute bottom-4 right-4 z-20 flex flex-col gap-1.5">
				{[['+', 'Zoom in', () => set_zoom((z) => Math.min(1.4, +(z + 0.1).toFixed(2)))], [`${Math.round(zoom * 100)}%`, 'Reset zoom', () => set_zoom(1)], ['−', 'Zoom out', () => set_zoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))]].map(([t, l, f]) => (
					<button key={l as string} type="button" aria-label={l as string} onClick={f as () => void} className="h-8 min-w-8 rounded-lg border border-[#2c2f35] bg-[rgba(22,23,26,.9)] px-2 text-[12px] text-[var(--g-ink-2)]">{t as string}</button>
				))}
			</div>
			{preview ? (
				<div className="absolute bottom-4 left-4 z-20 flex flex-wrap gap-1.5" data-testid="preview-banner">
					<span className="rounded-full border border-[rgba(124,108,255,.35)] bg-[rgba(124,108,255,.14)] px-2.5 py-0.5 text-[11.5px] font-semibold text-[#cfc7ff]">✦ Previewing AI changes</span>
					{preview.added.size ? <span className="rounded-full bg-[var(--g-ok-soft)] px-2.5 py-0.5 text-[11.5px] font-semibold text-[var(--g-ok)]">+{preview.added.size}</span> : null}
					{preview.changed.size ? <span className="rounded-full bg-[var(--g-warn-soft)] px-2.5 py-0.5 text-[11.5px] font-semibold text-[var(--g-warn-text)]">~{preview.changed.size}</span> : null}
					{preview.removed.length ? <span className="rounded-full bg-[var(--g-bad-soft)] px-2.5 py-0.5 text-[11.5px] font-semibold text-[var(--g-bad)]">−{preview.removed.join(', ')}</span> : null}
				</div>
			) : null}
			{toast ? <p role="status" className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-[#33363c] bg-[#16171a] px-3 py-2 text-[12.5px] text-[var(--g-ink)] shadow-lg">{toast}</p> : null}
		</div>
	);
}
