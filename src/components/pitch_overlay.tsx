import { useCallback, useEffect, useState } from 'react';

/**
 * Hidden pitch deck — ⌘⇧P / Ctrl⇧P. Not linked from nav.
 */
export function Pitch_overlay() {
	const [open, set_open] = useState(false);

	const toggle = useCallback(() => {
		set_open((v) => !v);
	}, []);

	useEffect(() => {
		function on_key(e: KeyboardEvent) {
			const mod = e.metaKey || e.ctrlKey;
			if (!mod || !e.shiftKey) return;
			if (e.key !== 'P' && e.key !== 'p') return;
			e.preventDefault();
			toggle();
		}
		window.addEventListener('keydown', on_key);
		return () => window.removeEventListener('keydown', on_key);
	}, [toggle]);

	useEffect(() => {
		if (!open) return;
		function on_esc(e: KeyboardEvent) {
			if (e.key === 'Escape') set_open(false);
		}
		window.addEventListener('keydown', on_esc);
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			window.removeEventListener('keydown', on_esc);
			document.body.style.overflow = prev;
		};
	}, [open]);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-[200] bg-[#0c0f12]"
			role="dialog"
			aria-modal="true"
			aria-label="Presentation"
		>
			<button
				type="button"
				onClick={() => set_open(false)}
				className="absolute right-3 top-3 z-10 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-medium text-white/50 backdrop-blur hover:bg-black/60 hover:text-white/90"
				aria-label="Close presentation"
			>
				Esc
			</button>
			<iframe
				title="Presentation"
				src="/customer-pitch/index.html"
				className="h-full w-full border-0"
			/>
		</div>
	);
}
