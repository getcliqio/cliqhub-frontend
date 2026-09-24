/** Format a Hub/control-plane epoch ms value (number or BIGINT string). */
export function format_date(value: number | string | null | undefined): string {
	const ms = to_ms(value);
	if (ms === null) return '—';
	return new Date(ms).toLocaleDateString();
}

export function format_datetime(value: number | string | null | undefined): string {
	const ms = to_ms(value);
	if (ms === null) return '—';
	return new Date(ms).toLocaleString();
}

function to_ms(value: number | string | null | undefined): number | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value === 'number') {
		if (!Number.isFinite(value) || value <= 0) return null;
		return value;
	}
	const as_number = Number(value);
	if (Number.isFinite(as_number) && as_number > 0 && /^\d+(\.\d+)?$/.test(value.trim())) {
		return as_number;
	}
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return null;
	return parsed;
}
