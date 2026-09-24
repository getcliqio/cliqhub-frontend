import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { GettingStartedPanel } from '@/components/getting_started_panel';

export function Component() {
	return (
		<div>
			<Breadcrumbs
				items={[
					{ label: 'Home', to: '/home' },
					{ label: 'Getting started' },
				]}
			/>
			<GettingStartedPanel />
		</div>
	);
}
