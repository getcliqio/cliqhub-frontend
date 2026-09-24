import { useLocation } from 'react-router';

const TITLES: Record<string, { title: string; blurb: string }> = {
	'/runs': {
		title: 'Runs',
		blurb: 'Execution history across daemons. Wired in the Runs slice.',
	},
	'/logs': {
		title: 'Logs',
		blurb: 'Log explorer for runs and daemons. Wired in the Logs slice.',
	},
	'/notifications': {
		title: 'Notifications',
		blurb: 'Delivery inbox for realm events. Channels stay under Account.',
	},
	'/reviews': {
		title: 'Reviews',
		blurb: 'Human gates via Hug. Hub entry and deep links land in the Reviews slice.',
	},
};

export function Component() {
	const { pathname } = useLocation();
	const meta = TITLES[pathname] ?? {
		title: 'Coming soon',
		blurb: 'This surface is on the production route map and will be wired next.',
	};

	return (
		<div>
			<h1 className="text-2xl font-extrabold">{meta.title}</h1>
			<p className="mt-2 text-sm text-slate-500">{meta.blurb}</p>
		</div>
	);
}
