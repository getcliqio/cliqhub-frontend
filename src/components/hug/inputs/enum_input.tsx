/**
 * An `enum` input. One choice: buttons (`ui.display: 'buttons'`, or a few choices) or a select;
 * `multiple`: checkboxes.
 */
import { G_INPUT } from '@/components/graphite/g_agents';
import { Field, control_id, invalid_cls, type Input_props } from './field';

const CHIP = (on: boolean) => `rounded-full border px-3 py-1 text-[12.5px] disabled:opacity-40 ${on ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;

export function Enum_input({ input, value, on_change, error, disabled }: Input_props<string | string[]>) {
	if (input.type !== 'enum') return null;
	const id = control_id(input.name);
	if (input.multiple) {
		const picked = Array.isArray(value) ? value : [];
		const toggle = (v: string) => on_change(picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v]);
		return (
			<Field input={input} error={error} as_label={false}>
				<div className="flex flex-col gap-1">
					{input.choices.map((c) => (
						<label key={c.value} className="flex items-center gap-2 text-[13px]">
							<input type="checkbox" checked={picked.includes(c.value)} disabled={disabled} onChange={() => toggle(c.value)} />
							{c.label ?? c.value}
						</label>
					))}
				</div>
			</Field>
		);
	}
	const v = typeof value === 'string' ? value : '';
	const as_buttons = input.ui?.display === 'buttons' || (input.ui?.display !== 'select' && input.choices.length <= 5);
	if (as_buttons) {
		return (
			<Field input={input} error={error} as_label={false}>
				<div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1.5">
					{input.choices.map((c) => (
						<button key={c.value} type="button" role="radio" aria-checked={v === c.value} disabled={disabled} onClick={() => on_change(c.value)} className={CHIP(v === c.value)}>
							{c.label ?? c.value}
						</button>
					))}
				</div>
			</Field>
		);
	}
	return (
		<Field input={input} error={error}>
			<select id={id} value={v} disabled={disabled} onChange={(e) => on_change(e.target.value)} className={`${G_INPUT} w-full ${invalid_cls(error)}`}>
				<option value="">— choose —</option>
				{input.choices.map((c) => <option key={c.value} value={c.value}>{c.label ?? c.value}</option>)}
			</select>
		</Field>
	);
}
