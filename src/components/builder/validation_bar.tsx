import { useEffect, useRef, useCallback, useState } from 'react';
import { useBuilder, useBuilderDispatch } from '@/lib/builder/store';

export function ValidationBar() {
	const state = useBuilder();
	const dispatch = useBuilderDispatch();
	const timer_ref = useRef<ReturnType<typeof setTimeout>>(undefined);
	const [validation_error, setValidationError] = useState<string | null>(null);

	const run_validation = useCallback(async () => {
		if (!state.team) return;

		try {
			const res = await fetch('/v1/teams/build', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
				body: JSON.stringify({ action: 'validate', team: state.team }),
			});

			const data = await res.json();
			if (data.ok) {
				dispatch({ type: 'SET_VALIDATION', validation: data.data });
				setValidationError(null);
				return;
			}
			setValidationError(data.error?.message || 'Validation unavailable');
		} catch {
			setValidationError('Validation unavailable');
		}
	}, [state.team, dispatch]);

	useEffect(() => {
		if (!state.team) return;
		clearTimeout(timer_ref.current);
		timer_ref.current = setTimeout(run_validation, 800);
		return () => clearTimeout(timer_ref.current);
	}, [state.team, run_validation]);

	if (!state.team) return null;

	if (validation_error) {
		return (
			<div className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
				<span className="font-semibold text-amber-700">{validation_error}</span>
			</div>
		);
	}

	if (!state.validation) return null;

	const { valid, errors, warnings: raw_warnings } = state.validation;
	const warnings = raw_warnings.filter(w => !w.includes('is never referenced via $(inputs.'));
	const total = errors.length + warnings.length;

	return (
		<div className={`flex items-center gap-4 border-t px-4 py-2.5 text-sm ${
			!valid
				? 'border-red-200 bg-red-50'
				: warnings.length > 0
					? 'border-amber-200 bg-amber-50'
					: 'border-emerald-200 bg-emerald-50'
		}`}>
			<div className="flex items-center gap-2">
				{valid ? (
					<span className={`font-semibold ${warnings.length > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
						{warnings.length > 0 ? `Valid with ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : 'Valid'}
					</span>
				) : (
					<span className="font-semibold text-red-700">
						{errors.length} error{errors.length > 1 ? 's' : ''}
					</span>
				)}
			</div>

			{total > 0 && (
				<div className="flex flex-1 flex-wrap gap-3 overflow-hidden">
					{errors.map((err, i) => (
						<span key={`e-${i}`} className="truncate rounded bg-red-100 px-2 py-0.5 text-red-700">
							{err}
						</span>
					))}
					{warnings.map((warn, i) => (
						<span key={`w-${i}`} className="truncate rounded bg-amber-100 px-2 py-0.5 text-amber-700">
							{warn}
						</span>
					))}
				</div>
			)}
		</div>
	);
}
