import { useEffect, useId, useRef, useState } from 'react';
import {
	type Binding_scope,
	type Event_group,
	event_groups_for_scope,
	event_leaves_for_scope,
	group_check_state,
	leaf_checked,
	summarize_selectors,
	toggle_group,
	toggle_leaf,
} from '@/lib/notification_event_catalog';

interface Event_selector_dropdown_props {
	scope: Binding_scope;
	selected: string[];
	on_change: (next: string[]) => void;
	disabled?: boolean;
}

export function Event_selector_dropdown({
	scope,
	selected,
	on_change,
	disabled = false,
}: Event_selector_dropdown_props) {
	const [open, set_open] = useState(false);
	const root_ref = useRef<HTMLDivElement>(null);
	const list_id = useId();
	const groups = event_groups_for_scope(scope);
	const leaves = event_leaves_for_scope(scope);

	useEffect(() => {
		if (!open) return;

		function on_pointer_down(event: MouseEvent) {
			if (!root_ref.current) return;
			if (root_ref.current.contains(event.target as Node)) return;
			set_open(false);
		}

		function on_key_down(event: KeyboardEvent) {
			if (event.key !== 'Escape') return;
			set_open(false);
		}

		document.addEventListener('mousedown', on_pointer_down);
		document.addEventListener('keydown', on_key_down);
		return () => {
			document.removeEventListener('mousedown', on_pointer_down);
			document.removeEventListener('keydown', on_key_down);
		};
	}, [open]);

	function set_group_checkbox(group: Event_group, el: HTMLInputElement | null) {
		if (!el) return;
		el.indeterminate = group_check_state(selected, group) === 'indeterminate';
	}

	return (
		<div ref={root_ref} className="relative">
			<button
				type="button"
				disabled={disabled}
				aria-expanded={open}
				aria-controls={list_id}
				onClick={() => set_open((v) => !v)}
				className="mt-1 flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm outline-none hover:border-slate-300 focus:border-indigo-400 disabled:opacity-50"
			>
				<span className={selected.length === 0 ? 'text-slate-400' : 'text-slate-800'}>
					{summarize_selectors(selected, scope)}
				</span>
				<span className="ml-2 text-slate-400" aria-hidden>
					{open ? '▴' : '▾'}
				</span>
			</button>

			{open ? (
				<div
					id={list_id}
					role="listbox"
					aria-multiselectable="true"
					className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-2 shadow-lg"
				>
					{groups.map((group) => {
						const state = group_check_state(selected, group);
						return (
							<div key={group.value} className="px-1">
								<label className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50">
									<input
										type="checkbox"
										checked={state === 'checked'}
										ref={(el) => set_group_checkbox(group, el)}
										onChange={(e) => on_change(toggle_group(selected, group, e.target.checked))}
										className="rounded border-slate-300"
									/>
									<span>{group.label}</span>
									<code className="ml-auto text-[10px] font-normal text-slate-400">{group.value}</code>
								</label>
								<div className="mb-1 ml-6 border-l border-slate-100 pl-2">
									{group.children.map((child) => (
										<label
											key={child.value}
											className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
										>
											<input
												type="checkbox"
												checked={leaf_checked(selected, group, child.value)}
												onChange={(e) =>
													on_change(toggle_leaf(selected, group, child.value, e.target.checked))
												}
												className="rounded border-slate-300"
											/>
											<span>{child.label}</span>
											<code className="ml-auto text-[10px] text-slate-400">{child.value}</code>
										</label>
									))}
								</div>
							</div>
						);
					})}

					{leaves.length > 0 ? (
						<div className="mt-1 border-t border-slate-100 px-1 pt-1">
							{leaves.map((leaf) => (
								<label
									key={leaf.value}
									className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
								>
									<input
										type="checkbox"
										checked={leaf_checked(selected, null, leaf.value)}
										onChange={(e) =>
											on_change(toggle_leaf(selected, null, leaf.value, e.target.checked))
										}
										className="rounded border-slate-300"
									/>
									<span>{leaf.label}</span>
									<code className="ml-auto text-[10px] text-slate-400">{leaf.value}</code>
								</label>
							))}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
