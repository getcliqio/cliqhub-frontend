export interface Facet_option {
	value: string;
	label?: string;
	count: number;
}

export interface Facet_group {
	key: string;
	title: string;
	options: Facet_option[];
}

interface Facet_sidebar_props {
	groups: Facet_group[];
	selected: Record<string, Set<string>>;
	on_toggle: (key: string, value: string) => void;
	on_clear?: (key: string) => void;
}

export function Facet_sidebar({ groups, selected, on_toggle, on_clear }: Facet_sidebar_props) {
	return (
		<aside className="w-full shrink-0 space-y-5 lg:w-56" aria-label="Filters">
			{groups.map((group) => {
				const sel = selected[group.key] ?? new Set();
				return (
					<div key={group.key}>
						<div className="mb-1.5 flex items-center justify-between gap-2">
							<h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
								{group.title}
							</h4>
							{sel.size > 0 && on_clear ? (
								<button
									type="button"
									onClick={() => on_clear(group.key)}
									className="text-[10px] font-semibold text-indigo-600 hover:underline"
								>
									Clear
								</button>
							) : null}
						</div>
						{group.options.length === 0 ? (
							<p className="text-xs text-slate-400">No values</p>
						) : (
							<ul className="space-y-0.5">
								{group.options.map((opt) => {
									const checked = sel.has(opt.value);
									return (
										<li key={opt.value}>
											<label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-slate-700 hover:bg-slate-50">
												<input
													type="checkbox"
													checked={checked}
													onChange={() => on_toggle(group.key, opt.value)}
													className="accent-indigo-600"
												/>
												<span className="min-w-0 flex-1 truncate">
													{opt.label ?? opt.value}
												</span>
												<span className="tabular-nums text-slate-400">{opt.count}</span>
											</label>
										</li>
									);
								})}
							</ul>
						)}
					</div>
				);
			})}
		</aside>
	);
}
