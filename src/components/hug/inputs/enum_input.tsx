/**
 * An `enum` input. One choice: radio buttons, or a select when there are many choices;
 * `multiple`: checkboxes. Display hints (`ui.display`) are not read — every Hug looks alike
 * (PLAN-hug-requests §13).
 */
import { G_INPUT } from '@/components/graphite/g_agents';
import { Field, control_id, invalid_cls, type Input_props } from './field';

/** Up to this many choices are radio buttons; more are a select. */
const RADIO_MAX = 8;

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
	if (input.choices.length <= RADIO_MAX) {
		return (
			<Field input={input} error={error} as_label={false}>
				<div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-col gap-1.5">
					{input.choices.map((c) => (
						<label key={c.value} className="flex items-center gap-2 text-[13px]">
							<input type="radio" name={id} value={c.value} checked={v === c.value} disabled={disabled} onChange={() => on_change(c.value)} />
							{c.label ?? c.value}
						</label>
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
