/** Inline Confirm / No — same pattern for run, cancel, unbind, uninstall. */

export function Confirm_action({
	busy,
	busy_label,
	confirm_label = 'Confirm',
	on_confirm,
	on_cancel,
}: {
	busy: boolean;
	busy_label?: string;
	confirm_label?: string;
	on_confirm: () => void;
	on_cancel: () => void;
}) {
	return (
		<span className="inline-flex items-center gap-2">
			<button
				type="button"
				disabled={busy}
				onClick={on_confirm}
				className="text-[11px] font-semibold text-red-600 hover:underline disabled:opacity-50"
			>
				{busy ? (busy_label ?? 'Working…') : confirm_label}
			</button>
			<button
				type="button"
				onClick={on_cancel}
				className="text-[11px] font-semibold text-slate-400 hover:underline"
			>
				No
			</button>
		</span>
	);
}
