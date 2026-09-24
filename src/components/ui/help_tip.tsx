import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface HelpTipProps {
	label: string;
	children: string;
	/** Optional docs page opened from the tip. */
	docs_href?: string;
}

/** Compact "?" control; tooltip is portaled so it is never clipped by sidebars. */
export function HelpTip({ label, children, docs_href }: HelpTipProps) {
	const tip_id = useId();
	const button_ref = useRef<HTMLButtonElement>(null);
	const tip_ref = useRef<HTMLSpanElement>(null);
	const [open, set_open] = useState(false);
	const [coords, set_coords] = useState<{ top: number; left: number } | null>(null);

	function place_tip() {
		const button = button_ref.current;
		if (!button) return;
		const rect = button.getBoundingClientRect();
		const tip_width = 288;
		const margin = 8;
		let left = rect.left;
		if (left + tip_width > window.innerWidth - margin) {
			left = Math.max(margin, window.innerWidth - tip_width - margin);
		}
		set_coords({ top: rect.bottom + 8, left });
	}

	useLayoutEffect(() => {
		if (!open) {
			set_coords(null);
			return;
		}
		place_tip();
	}, [open]);

	useEffect(() => {
		if (!open) return;
		function on_reposition() {
			place_tip();
		}
		function on_pointer_down(event: MouseEvent) {
			const target = event.target as Node;
			if (button_ref.current?.contains(target)) return;
			if (tip_ref.current?.contains(target)) return;
			set_open(false);
		}
		window.addEventListener('resize', on_reposition);
		window.addEventListener('scroll', on_reposition, true);
		document.addEventListener('mousedown', on_pointer_down);
		return () => {
			window.removeEventListener('resize', on_reposition);
			window.removeEventListener('scroll', on_reposition, true);
			document.removeEventListener('mousedown', on_pointer_down);
		};
	}, [open]);

	return (
		<span className="relative inline-flex shrink-0 align-middle">
			<button
				ref={button_ref}
				type="button"
				aria-label={`About ${label}`}
				aria-expanded={open}
				aria-controls={tip_id}
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					set_open((v) => !v);
				}}
				className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] font-bold leading-none text-slate-500 normal-case tracking-normal hover:border-indigo-300 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
			>
				?
			</button>
			{open && coords && createPortal(
				<span
					ref={tip_ref}
					id={tip_id}
					role="tooltip"
					style={{ top: coords.top, left: coords.left }}
					className="fixed z-[100] w-72 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs font-normal normal-case tracking-normal text-slate-600 shadow-lg"
				>
					<p>{children}</p>
					{docs_href ? (
						<a
							href={docs_href}
							target="_blank"
							rel="noopener noreferrer"
							className="mt-2 inline-flex font-semibold text-indigo-600 hover:underline"
						>
							Docs →
						</a>
					) : null}
				</span>,
				document.body,
			)}
		</span>
	);
}
