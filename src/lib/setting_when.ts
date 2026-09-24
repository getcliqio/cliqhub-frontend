/**
 * Provider-conditional agent settings (`when: { provider: "github" }`).
 * Missing provider defaults to github (git agent).
 */
export function setting_applies(
	setting: { when?: Record<string, string> } | string,
	values: Record<string, string | undefined | null>,
): boolean {
	if (typeof setting === 'string') return true;
	const when = setting.when;
	if (!when || Object.keys(when).length === 0) return true;
	for (const [key, expected] of Object.entries(when)) {
		let actual = values[key];
		if ((actual == null || actual === '') && key === 'provider') {
			actual = 'github';
		}
		if (String(actual ?? '') !== expected) return false;
	}
	return true;
}
