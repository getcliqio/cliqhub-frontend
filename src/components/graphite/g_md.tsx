/** Markdown (Graphite): GitHub tables and task lists; raw HTML is not rendered (react-markdown default). */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Md({ children, class_name = '' }: { children: string; class_name?: string }) {
	return (
		<div className={`g-md ${class_name}`}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children: c }) => <a href={href} target="_blank" rel="noreferrer noopener">{c}</a> }}>{children}</ReactMarkdown>
		</div>
	);
}
