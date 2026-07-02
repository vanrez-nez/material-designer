import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/github-dark.css";

import { cn } from "@/lib/utils";

function isHighlightedCode(className?: string) {
  return /\blanguage-|\bhljs\b/.test(className ?? "");
}

export const MARKDOWN_COMPONENTS = {
  a: ({ className, ...props }: { className?: string }) => (
    <a
      className={cn("font-medium text-primary underline underline-offset-2", className)}
      rel="noreferrer"
      target="_blank"
      {...props}
    />
  ),
  code: ({ className, ...props }: { className?: string }) =>
    isHighlightedCode(className) ? (
      <code className={className} {...props} />
    ) : (
      <code
        className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]", className)}
        {...props}
      />
    ),
  h1: ({ className, ...props }: { className?: string }) => (
    <h1 className={cn("mt-3 mb-1 text-sm font-semibold first:mt-0", className)} {...props} />
  ),
  h2: ({ className, ...props }: { className?: string }) => (
    <h2 className={cn("mt-3 mb-1 text-sm font-semibold first:mt-0", className)} {...props} />
  ),
  h3: ({ className, ...props }: { className?: string }) => (
    <h3 className={cn("mt-2 mb-1 text-sm font-semibold first:mt-0", className)} {...props} />
  ),
  li: ({ className, ...props }: { className?: string }) => (
    <li className={cn("my-0.5", className)} {...props} />
  ),
  ol: ({ className, ...props }: { className?: string }) => (
    <ol className={cn("my-1 list-decimal pl-4", className)} {...props} />
  ),
  p: ({ className, ...props }: { className?: string }) => (
    <p className={cn("my-1.5 first:mt-0 last:mb-0", className)} {...props} />
  ),
  pre: ({ className, ...props }: { className?: string }) => (
    <pre
      className={cn(
        "my-2 overflow-x-auto rounded-md bg-muted/60 p-3 text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }: { className?: string }) => (
    <ul className={cn("my-1 list-disc pl-4", className)} {...props} />
  ),
};

type MarkdownContentProps = {
  className?: string;
  content: string;
};

export function MarkdownContent({ className, content }: MarkdownContentProps) {
  return (
    <div className={cn("text-sm leading-relaxed break-words", className)}>
      <Markdown
        components={MARKDOWN_COMPONENTS}
        rehypePlugins={[rehypeHighlight]}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </Markdown>
    </div>
  );
}
