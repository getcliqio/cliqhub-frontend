/** A `number` input; kept as typed (a string) until it is sent. */
import { G_INPUT } from '@/components/graphite/g_agents';
import { Field, control_id, invalid_cls, type Input_props } from './field';

export function Number_input({ input, value, on_change, error, disabled }: Input_props<string>) {
	if (input.type !== 'number') return null;
	return (
		<Field input={input} error={error}>
			<input
				id={control_id(input.name)}
				type="number"
				inputMode={input.integer ? 'numeric' : 'decimal'}
				step={input.integer ? 1 : 'any'}
				min={input.min}
				max={input.max}
				value={value}
				disabled={disabled}
				aria-invalid={Boolean(error) || undefined}
				onChange={(e) => on_change(e.target.value)}
				className={`${G_INPUT} max-w-[200px] ${invalid_cls(error)}`}
			/>
		</Field>
	);
}
