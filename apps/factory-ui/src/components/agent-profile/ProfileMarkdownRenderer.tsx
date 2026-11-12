import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function ProfileMarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="min-w-0 space-y-4 text-sm leading-7 text-foreground [overflow-wrap:anywhere] [&_h1]:mt-6 [&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:mt-4 [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_li>ul]:mt-1 [&_li>ol]:mt-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_hr]:border-border [&_a]:text-info [&_a]:underline [&_a]:underline-offset-4 [&_strong]:font-semibold [&_input]:accent-primary">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} skipHtml components={{
        a: ({ href, children }) => href && /^https?:\/\//i.test(href)
          ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          : <span>{children}</span>,
        img: ({ alt }) => <span className="text-muted-foreground">{alt}</span>,
        table: ({ children }) => <Table className="text-sm">{children}</Table>,
        thead: ({ children }) => <TableHeader>{children}</TableHeader>,
        tbody: ({ children }) => <TableBody>{children}</TableBody>,
        tr: ({ children }) => <TableRow>{children}</TableRow>,
        th: ({ children }) => <TableHead className="whitespace-normal">{children}</TableHead>,
        td: ({ children }) => <TableCell className="whitespace-normal">{children}</TableCell>,
      }}>{content}</ReactMarkdown>
    </div>
  );
}
