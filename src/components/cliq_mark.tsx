import { useId } from 'react';

/** Cliq brand mark — same mesh icon as getcliq.io / favicon. */
export function Cliq_mark({
	class_name = 'h-7 w-7',
	title = 'cliq',
}: {
	class_name?: string;
	title?: string;
}) {
	const grad_id = useId().replace(/:/g, '');

	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 32 32"
			fill="none"
			className={class_name}
			role="img"
			aria-label={title}
		>
			<title>{title}</title>
			<defs>
				<linearGradient id={grad_id} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
					<stop offset="0%" stopColor="#6366f1" />
					<stop offset="100%" stopColor="#a855f7" />
				</linearGradient>
			</defs>
			<rect width="32" height="32" rx="7" fill={`url(#${grad_id})`} />
			<g stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
				<circle cx="10" cy="10" r="2.2" />
				<circle cx="22" cy="10" r="2.2" />
				<circle cx="10" cy="22" r="2.2" />
				<circle cx="22" cy="22" r="2.2" />
				<path d="M12.2 10h7.6" />
				<path d="M10 12.2v7.6" />
				<path d="M22 12.2v7.6" />
				<path d="M12.2 22h7.6" />
			</g>
		</svg>
	);
}
