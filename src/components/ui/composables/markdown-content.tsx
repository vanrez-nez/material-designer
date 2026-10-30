type MarkdownContentProps = {
  className?: string;
  content: string;
};

// Authored Markdown such as the help docs (tp-markdown): GitHub Flavored Markdown rendered as real elements,
// with fenced code as the library's Code block. The dense size suits popovers and side panels.
export function MarkdownContent({ className, content }: MarkdownContentProps) {
  return <tp-markdown className={className} data-slot="markdown" size="sm" source={content} />;
}
