'use client';

import { memo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github.css';
import { useI18n } from '@/lib/i18n';

function ReportCodeBlock({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role -- A named, focusable pre preserves code semantics and lets keyboard users scroll long lines.
    <pre tabIndex={0} role="region" aria-label={t('Code block')}>
      {children}
    </pre>
  );
}

const components: Components = {
  pre: ReportCodeBlock,
  table: ({ children }) => (
    <div className="ws-md-table-wrap">
      <table>{children}</table>
    </div>
  ),
  code: ({ children, className }) => {
    const language = /(?:^|\s)language-(\S+)/.exec(className || '')?.[1];
    if (
      typeof children !== 'string' ||
      children.length > 200000 ||
      !language ||
      !hljs.getLanguage(language)
    ) {
      return <code className={className}>{children}</code>;
    }
    // Highlight.js escapes the source before adding its own span markup.
    // Raw Markdown HTML stays under ReactMarkdown's default safe handling.
    const html = hljs.highlight(children, {
      language,
      ignoreIllegals: true,
    }).value;
    return (
      <code
        className={`hljs ${className}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  },
};

export const ReportMarkdown = memo(function ReportMarkdown({
  children,
}: {
  children: string;
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
});
