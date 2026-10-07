/**
 * Shape palette: a compact grid of phase kinds, like a diagramming tool's
 * shape library. Each tile is a glyph plus the kind's name; the description is
 * in the tooltip. Drag a tile onto the canvas, or click it to add after the
 * selected phase (or as a new branch when nothing is selected).
 */
import { KINDS, PALETTE, type Kind_id } from '@/lib/builder/kinds';
import { KIND_MIME, Kind_tile } from '@/components/gbuilder/gb_canvas';

export function Shape_palette({ selected, on_add }: { selected: string | null; on_add: (k: Kind_id) => void }) {
	return (
		<section aria-labelledby="gb-shapes-title" data-testid="palette">
			<h2 id="gb-shapes-title" className="mb-1.5 flex items-baseline px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">
				Add a phase<span className="ml-auto font-normal normal-case tracking-normal">drag or click</span>
			</h2>
			<ul className="grid grid-cols-3 gap-1.5">
				{PALETTE.map((k) => {
					const tip = `${KINDS[k].label} — ${KINDS[k].blurb}. ${selected ? `Click to add after ${selected}` : 'Click to add'}, or drag onto the canvas.`;
					return (
						<li key={k}>
							<button
								type="button"
								draggable
								onDragStart={(e) => { e.dataTransfer.setData(KIND_MIME, k); e.dataTransfer.setData('text/plain', k); e.dataTransfer.effectAllowed = 'copy'; }}
								onClick={() => on_add(k)}
								title={tip}
								className="flex h-[58px] w-full cursor-grab flex-col items-center justify-center gap-1 rounded-lg border border-[var(--g-line)] bg-[var(--g-panel)] px-1 text-center hover:border-[var(--g-acc-line)] hover:bg-[var(--g-soft)] focus-visible:border-[var(--g-acc)] focus-visible:outline-none active:cursor-grabbing"
								data-testid={`tile-${k}`}
							>
								<Kind_tile kind={k} size={22} />
								<span className="line-clamp-2 w-full text-[10.5px] font-medium leading-[1.15] text-[var(--g-ink-2)]">{KINDS[k].label}</span>
							</button>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
