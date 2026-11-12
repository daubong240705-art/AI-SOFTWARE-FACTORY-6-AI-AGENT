import { MarkdownContent } from '@/components/MarkdownContent';

export default function ProfileMarkdownRenderer({ content }: { content: string }) {
  return <MarkdownContent content={content} />;
}
