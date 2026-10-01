/**
 * Build › New team / edit team (Graphite builder). State restore (?draft=,
 * fork/view session keys) uses the shared StateRestorer.
 */
import { BuilderProvider } from '@/lib/builder/store';
import { StateRestorer } from '@/components/builder/builder_shell';
import { Gb_app } from '@/components/gbuilder/gb_app';

export function Component() {
	return (
		<BuilderProvider>
			<StateRestorer />
			<Gb_app />
		</BuilderProvider>
	);
}
