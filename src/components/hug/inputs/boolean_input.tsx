/** A `boolean` input: a switch. */
import { input_label } from '@/lib/hug';
import { control_id, type Input_props } from './field';

export function Boolean_input({ input, value, on_change, error, disabled }: Input_props<boolean>) {
	if (input.type !== 'boolean') return null;
	const id = control_id(input.name);
	return (
		<div className="flex items-start gap-3">
			<button
				id={id}
				type="button"
				role="switch"
				aria-checked={value}
				aria-labelledby={`${id}-label`}
				disabled={disabled}
				onClick={() => on_change(!value)}
				className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${value ? 'bg-[var(--g-acc)]' : 'bg-[var(--g-line)]'}`}
			>
				<span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--g-bg)] transition-all ${value ? 'left-[18px]' : 'left-0.5'}`} />
			</button>
			<div className="flex flex-col gap-0.5">
				<span id={`${id}-label`} className="text-[12.5px] text-[var(--g-ink-2)]">{input_label(input)}</span>
				{input.help ? <span className="text-[11.5px] text-[var(--g-ink-3)]">{input.help}</span> : null}
				{error ? <span role="alert" className="text-[11.5px] text-[var(--g-bad)]">{error}</span> : null}
			</div>
		</div>
	);
}
