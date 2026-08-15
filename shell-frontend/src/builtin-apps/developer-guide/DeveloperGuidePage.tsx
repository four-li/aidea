import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTable } from 'micromark-extension-gfm-table';
import ReactMarkdown from 'react-markdown';
import type { Processor } from 'unified';
import { Button } from '@/components/ui/button';
import { GUIDE_DOCUMENTS } from './documents';

function remarkTables(this: Processor) {
  const data = this.data() as {
    micromarkExtensions?: unknown[];
    fromMarkdownExtensions?: unknown[];
  };
  const micromarkExtensions = data.micromarkExtensions ?? [];
  const fromMarkdownExtensions = data.fromMarkdownExtensions ?? [];

  micromarkExtensions.push(gfmTable());
  fromMarkdownExtensions.push(gfmTableFromMarkdown());
  data.micromarkExtensions = micromarkExtensions;
  data.fromMarkdownExtensions = fromMarkdownExtensions;
}

export function DeveloperGuidePage() {
  const [activeDocumentId, setActiveDocumentId] = useState('README.md');
  const activeDocument =
    GUIDE_DOCUMENTS.find((document) => document.id === activeDocumentId) ?? GUIDE_DOCUMENTS[0];

  return (
    <div className="flex h-full min-w-0 bg-background">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-muted/20 p-3">
        <div className="flex h-8 items-center gap-2 px-2 text-sm font-semibold">
          <BookOpen aria-hidden="true" />
          开发手册
        </div>
        <nav className="mt-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" aria-label="开发手册目录">
          {GUIDE_DOCUMENTS.map((document) => (
            <Button
              key={document.id}
              type="button"
              variant={document.id === activeDocument.id ? 'secondary' : 'ghost'}
              size="sm"
              className="w-full justify-start"
              onClick={() => setActiveDocumentId(document.id)}
            >
              {document.label}
            </Button>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <article className="mx-auto w-full max-w-4xl px-6 py-8 text-sm leading-7 text-foreground sm:px-10">
          <ReactMarkdown
            // 仅启用手册实际使用的表格，避开 macOS 13 WebView 不支持的 GFM 自动链接正则。
            remarkPlugins={[remarkTables]}
            components={{
              h1: ({ children }) => (
                <h1 className="mb-8 border-b border-border pb-4 text-2xl font-semibold leading-8">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="mb-3 mt-9 text-lg font-semibold leading-7">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="mb-2 mt-6 text-base font-semibold leading-6">{children}</h3>
              ),
              p: ({ children }) => <p className="my-3 text-muted-foreground">{children}</p>,
              ul: ({ children }) => (
                <ul className="my-3 list-disc space-y-1 pl-6 text-muted-foreground">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="my-3 list-decimal space-y-1 pl-6 text-muted-foreground">{children}</ol>
              ),
              li: ({ children }) => <li className="pl-1">{children}</li>,
              a: ({ href, children }) => {
                const target = href?.split('#', 1)[0];
                const document = GUIDE_DOCUMENTS.find((item) => item.id === target);
                if (document) {
                  return (
                    <button
                      type="button"
                      className="text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
                      onClick={() => setActiveDocumentId(document.id)}
                    >
                      {children}
                    </button>
                  );
                }
                return (
                  <a className="text-primary underline decoration-primary/40 underline-offset-4" href={href}>
                    {children}
                  </a>
                );
              },
              blockquote: ({ children }) => (
                <blockquote className="my-4 border-l-2 border-border pl-4 text-muted-foreground">
                  {children}
                </blockquote>
              ),
              code: ({ children }) => (
                <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem] text-foreground">
                  {children}
                </code>
              ),
              pre: ({ children }) => (
                <pre className="my-4 overflow-x-auto rounded-md border border-border bg-muted/40 p-4 leading-6">
                  {children}
                </pre>
              ),
              table: ({ children }) => (
                <div className="my-4 overflow-x-auto border border-border">
                  <table className="w-full border-collapse text-left">{children}</table>
                </div>
              ),
              th: ({ children }) => <th className="border-b border-border bg-muted px-3 py-2 font-medium">{children}</th>,
              td: ({ children }) => <td className="border-b border-border px-3 py-2 align-top">{children}</td>,
              hr: () => <div className="my-8 border-t border-border" />,
            }}
          >
            {activeDocument.content}
          </ReactMarkdown>
        </article>
      </main>
    </div>
  );
}
