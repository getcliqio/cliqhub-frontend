/** A `text` input: one line, or `multiline`. */
import { G_INPUT } from '@/components/graphite/g_agents';
import { Field, control_id, invalid_cls, type Input_props } from './field';

export function Text_input({ input, value, on_change, error, disabled }: Input_props<string>) {
	if (input.type !== 'text') return null;
	const common = {
		id: control_id(input.name),
		value,
		disabled,
		maxLength: input.max_length,
		placeholder: typeof input.ui?.placeholder === 'string' ? input.ui.placeholder : undefined,
		'aria-invalid': Boolean(error) || undefined,
		'aria-describedby': error ? `${control_id(input.name)}-error` : undefined,
		className: `${G_INPUT} w-full ${invalid_cls(error)}`,
	};
	return (
		<Field input={input} error={error}>
			{input.multiline
				? <textarea rows={4} {...common} onChange={(e) => on_change(e.target.value)} />
				: <input type="text" {...common} onChange={(e) => on_change(e.target.value)} />}
		</Field>
	);
}
