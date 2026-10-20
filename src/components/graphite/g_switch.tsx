/** An on/off switch (Graphite), used on the Events and Channels pages. */

/** An on/off switch; disabled shows it greyed, with why in `title`. */
export function Switch({ on, on_change, label, disabled = false, title }: { on: boolean; on_change: (next: boolean) => void; label: string; disabled?: boolean; title?: string }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			aria-label={label}
			title={title}
			disabled={disabled}
			onClick={() => on_change(!on)}
			className={`relative inline-block h-[17px] w-[30px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-[var(--g-acc)]' : 'bg-[var(--g-line-strong)]'}`}
		>
			<i aria-hidden className={`absolute top-[2px] h-[13px] w-[13px] rounded-full transition-[left] ${on ? 'left-[15px] bg-white' : 'left-[2px] bg-[var(--g-ink-3)]'}`} />
		</button>
	);
}
