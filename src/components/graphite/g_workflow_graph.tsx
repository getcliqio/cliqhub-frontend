/**
 * Workflow graph (Graphite). Layered DAG from a team version's phases:
 * nodes coloured by phase type, gradient edges with flowing dots, gate
 * loop-backs as dashed arcs, human review as a badge, and an optional run
 * overlay (status dot per phase). Pure SVG; scales to its container.
 */
import { useId, type KeyboardEvent, type ReactElement } from 'react';
import {
	REVIEW_COLOR, layout_phases, overlay_state, phase_kind, phase_kind_id, LEGEND_KINDS, phase_subtitle, type Team_phase,
} from '@/lib/team_page';

const W = 148;
const H = 58;
const PITCH_X = 196;
const PITCH_Y = 78;
const MARGIN_X = 72;

function hexa(hex: string, a: number): string {
	const n = Number.parseInt(hex.slice(1), 16);
	return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function bez(x1: number, y1: number, x2: number, y2: number): string {
	const dx = Math.max(44, (x2 - x1) * 0.5);
	return `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
const DOT: Record<string, string> = { done: '#3ecf8e', running: '#5b9dff', waiting: REVIEW_COLOR, failed: '#ff5c5c' };

export function Workflow_graph({
	phases,
	selected = null,
	on_select,
	statuses = null,
	height = 300,
	label = 'Team workflow',
}: {
	phases: Team_phase[];
	selected?: string | null;
	on_select?: (name: string) => void;
	/** Run overlay: phase name → run phase status. */
	statuses?: Record<string, string> | null;
	height?: number;
	label?: string;
}) {
	const uid = useId().replace(/[:]/g, '');
	const L = layout_phases(phases);
	if (!phases.length) {
		return <div className="grid place-items-center text-[12.5px] text-[var(--g-ink-3)]" style={{ height }}>This version has no phases.</div>;
	}
	const top_pad = L.loops.length ? 64 : 34;
	const w = MARGIN_X * 2 + (L.cols - 1) * PITCH_X + W;
	const h = Math.max(height, top_pad + L.rows * PITCH_Y + 34);
	const cy = top_pad + ((h - top_pad - 34) / 2);
	const at = (n: string) => {
		const p = L.pos[n];
		return { x: MARGIN_X + p.col * PITCH_X, y: cy + p.row * PITCH_Y - H / 2 };
	};
	const by_name = new Map(phases.map((p) => [p.name, p]));
	const roots = phases.filter((p) => !p.depends_on.some((d) => by_name.has(d)));
	const leaves = phases.filter((p) => !phases.some((q) => q.depends_on.includes(p.name)));
	const key = (e: KeyboardEvent, n: string) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); on_select?.(n); } };

	const edges: ReactElement[] = [];
	const defs: ReactElement[] = [];
	let i = 0;
	for (const p of phases) {
		for (const d of p.depends_on) {
			if (!by_name.has(d)) continue;
			const a = at(d); const b = at(p.name);
			const ca = phase_kind(by_name.get(d)!).color; const cb = phase_kind(p).color;
			const x1 = a.x + W; const y1 = a.y + H / 2; const x2 = b.x - 2; const y2 = b.y + H / 2;
			const id = `${uid}e${i++}`;
			const path = bez(x1, y1, x2, y2);
			defs.push(<linearGradient key={id} id={id} gradientUnits="userSpaceOnUse" x1={x1} y1={0} x2={x2} y2={0}><stop offset="0" stopColor={ca} stopOpacity={0.75} /><stop offset="1" stopColor={cb} stopOpacity={0.75} /></linearGradient>);
			edges.push(
				<g key={`${d}->${p.name}`} data-edge={`${d}->${p.name}`}>
					<path d={path} stroke={ca} strokeOpacity={0.1} strokeWidth={7} fill="none" />
					<path d={path} stroke={`url(#${id})`} strokeWidth={1.6} fill="none" />
					<path d={`M${x2 - 6} ${y2 - 4} L${x2} ${y2} L${x2 - 6} ${y2 + 4}`} stroke={cb} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
					<circle className="g-flow" r={2.6} fill="#fff" opacity={0.9}><animateMotion dur="2.6s" repeatCount="indefinite" begin={`-${(i * 0.7) % 2.6}s`} path={path} /></circle>
				</g>,
			);
		}
	}

	return (
		<svg role="group" aria-label={label} viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', maxHeight: h }}>
			<defs>
				<pattern id={`${uid}dots`} width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#1f2226" /></pattern>
				<radialGradient id={`${uid}aura`} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#7c6cff" stopOpacity={0.1} /><stop offset="1" stopColor="#7c6cff" stopOpacity={0} /></radialGradient>
				<linearGradient id={`${uid}nf`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1b1d22" /><stop offset="1" stopColor="#131417" /></linearGradient>
				<filter id={`${uid}soft`} x="-20%" y="-40%" width="140%" height="180%"><feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity={0.55} /></filter>
				{[...new Set(phases.map((p) => phase_kind(p).color))].map((c) => (
					<filter key={c} id={`${uid}gl${c.slice(1)}`} x="-40%" y="-60%" width="180%" height="220%"><feDropShadow dx="0" dy="0" stdDeviation="9" floodColor={c} floodOpacity={0.45} /></filter>
				))}
				{defs}
			</defs>
			<style>{'@media (prefers-reduced-motion: reduce){.g-flow{display:none}.g-march{animation:none}}'}</style>
			<rect width={w} height={h} fill={`url(#${uid}dots)`} />
			<ellipse cx={w / 2} cy={h / 2} rx={w * 0.45} ry={h * 0.6} fill={`url(#${uid}aura)`} />

			{/* start / end terminals */}
			{roots.map((r) => { const a = at(r.name); const sx = a.x - 34; const sy = a.y + H / 2; return (
				<g key={`start-${r.name}`} aria-hidden>
					<path d={`M${sx + 7} ${sy} H${a.x}`} stroke="#3a3d44" strokeWidth={1.5} strokeDasharray="3 4" />
					<circle cx={sx} cy={sy} r={7} fill="#0d0e10" stroke="#d4ff3f" strokeWidth={2} /><circle cx={sx} cy={sy} r={2.5} fill="#d4ff3f" />
				</g>
			); })}
			{leaves.map((r) => { const a = at(r.name); const ex = a.x + W + 30; const ey = a.y + H / 2; return (
				<g key={`end-${r.name}`} aria-hidden>
					<path d={`M${a.x + W} ${ey} H${ex - 8}`} stroke="#3a3d44" strokeWidth={1.5} strokeDasharray="3 4" />
					<circle cx={ex} cy={ey} r={8} fill="#0d0e10" stroke="#3ecf8e" strokeWidth={2} />
					<path d={`M${ex - 3.5} ${ey} l2.5 2.5 l4.5 -5`} stroke="#3ecf8e" strokeWidth={1.8} fill="none" strokeLinecap="round" />
				</g>
			); })}

			{edges}

			{L.loops.map((lp) => {
				const g = at(lp.from); const t = at(lp.to);
				const gx = g.x + W / 2; const tx = t.x + W / 2;
				const peak = Math.min(g.y, t.y) - 50;
				const mx = (gx + tx) / 2;
				return (
					<g key={`loop-${lp.from}`} data-loop={`${lp.from}->${lp.to}`}>
						<path className="g-march" d={`M${gx} ${g.y - 2} C${gx} ${peak}, ${tx} ${peak}, ${tx} ${t.y - 2}`} stroke="#f5a524" strokeWidth={1.5} strokeDasharray="5 5" fill="none" opacity={0.9} style={{ animation: 'g-march 1.2s linear infinite' }} />
						<path d={`M${tx - 4} ${t.y - 9} L${tx} ${t.y - 3} L${tx + 4} ${t.y - 9}`} stroke="#f5a524" strokeWidth={1.6} fill="none" strokeLinecap="round" />
						<g transform={`translate(${mx - 58},${peak + 1})`}>
							<rect width={116} height={22} rx={11} fill="#221a0b" stroke="#f5a524" strokeOpacity={0.55} />
							<text x={58} y={15} textAnchor="middle" fontSize={10.5} fill="#ffc766" fontWeight={600} fontFamily="var(--g-font)">↺ route back{lp.max ? ` · ≤ ${lp.max}` : ''}</text>
						</g>
					</g>
				);
			})}

			{phases.map((p) => {
				const { x, y } = at(p.name);
				const k = phase_kind(p);
				const badge = p.review && k.id !== 'human';
				const is_sel = selected === p.name;
				const st = statuses ? overlay_state(statuses[p.name]) : null;
				const title = p.name.length > 15 ? `${p.name.slice(0, 14)}…` : p.name;
				const sub = phase_subtitle(p);
				return (
					<g
						key={p.name}
						transform={`translate(${x},${y})`}
						role={on_select ? 'button' : undefined}
						tabIndex={on_select ? 0 : undefined}
						aria-label={`${p.name}, ${k.label}${badge ? ', human review' : ''}${st && st !== 'idle' ? `, ${st}` : ''}`}
						aria-pressed={on_select ? is_sel : undefined}
						data-phase={p.name}
						onClick={on_select ? () => on_select(p.name) : undefined}
						onKeyDown={on_select ? (e) => key(e, p.name) : undefined}
						style={{ cursor: on_select ? 'pointer' : 'default', outline: 'none' }}
					>
						<title>{`${p.name} — ${sub}`}</title>
						{is_sel ? <rect x={-5} y={-5} width={W + 10} height={H + 10} rx={16} fill="none" stroke={k.color} strokeOpacity={0.35} /> : null}
						<rect width={W} height={H} rx={12} fill={`url(#${uid}nf)`} stroke={is_sel ? k.color : hexa(k.color, 0.38)} strokeWidth={is_sel ? 1.5 : 1} filter={`url(#${uid}${is_sel ? `gl${k.color.slice(1)}` : 'soft'})`} />
						<rect x={1} y={1} width={W - 2} height={H * 0.5} rx={11} fill={k.color} opacity={0.05} />
						<rect x={10} y={H / 2 - 13} width={26} height={26} rx={8} fill={hexa(k.color, 0.14)} stroke={hexa(k.color, 0.35)} />
						<text x={23} y={H / 2 + 5} textAnchor="middle" fontSize={13} fill={k.color} fontWeight={700}>{k.glyph}</text>
						<text x={45} y={H / 2 - 3} fontSize={12.5} fill="#ecebe8" fontWeight={600} fontFamily="var(--g-font)">{title}</text>
						<text x={45} y={H / 2 + 13} fontSize={10.5} fill="#8a8c93" fontFamily="var(--g-mono)">{sub.length > 16 ? `${sub.slice(0, 15)}…` : sub}</text>
						{badge ? (
							<g transform={`translate(${W - 78},-10)`}>
								<rect width={74} height={19} rx={9.5} fill="#2a1424" stroke={REVIEW_COLOR} strokeOpacity={0.6} />
								<circle cx={12} cy={9.5} r={3} fill="none" stroke={REVIEW_COLOR} strokeWidth={1.4} />
								<text x={20} y={13.2} fontSize={9.5} fill={REVIEW_COLOR} fontWeight={700} letterSpacing=".04em" fontFamily="var(--g-font)">REVIEW</text>
							</g>
						) : null}
						{k.id === 'gate' && p.max_iterations ? (
							<g transform={`translate(${W - 46},-10)`}>
								<rect width={42} height={19} rx={9.5} fill="#221a0b" stroke="#f5a524" strokeOpacity={0.6} />
								<text x={21} y={13.2} textAnchor="middle" fontSize={9.5} fill="#ffc766" fontWeight={700} fontFamily="var(--g-mono)">×{p.max_iterations}</text>
							</g>
						) : null}
						{st && st !== 'idle' ? (
							<g data-status={st}>
								<circle cx={W - 12} cy={H - 12} r={4} fill={DOT[st]} />
								{st === 'running' ? <circle className="g-flow" cx={W - 12} cy={H - 12} r={4} fill="none" stroke={DOT[st]}><animate attributeName="r" from="4" to="11" dur="1.4s" repeatCount="indefinite" /><animate attributeName="opacity" from="1" to="0" dur="1.4s" repeatCount="indefinite" /></circle> : null}
							</g>
						) : st === 'idle' ? <circle cx={W - 12} cy={H - 12} r={3.5} fill="#4a4d55" /> : null}
					</g>
				);
			})}
		</svg>
	);
}

/** Legend for the graph (types, review, loop). */
export function Workflow_legend({ phases }: { phases?: Array<{ type: string; agent?: string | null }> } = {}) {
	// Only the kinds this team uses (all of them when unknown).
	const used = phases ? new Set(phases.map((p) => phase_kind_id(p))) : null;
	const ids = LEGEND_KINDS.filter((id) => !used || used.has(id));
	return (
		<span className="flex flex-wrap items-center gap-4 text-[11.5px] text-[var(--g-ink-3)]">
			{ids.map((id) => { const k = phase_kind(id); return (
				<span key={id} className="inline-flex items-center gap-1.5"><i className="block h-[9px] w-[9px] rounded-[3px]" style={{ background: k.color, boxShadow: `0 0 8px ${k.color}` }} />{k.label}</span>
			); })}
			<span className="text-[#ffc766]">- - ↺ route back</span>
		</span>
	);
}
