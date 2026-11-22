'use client';

import * as React from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import styles from './HomeQueryMarkdown.module.css';

type Props = {
  text: string;
  streaming?: boolean;
  navigation?: boolean;
  className?: string;
  'aria-label'?: string;
};
type Section = { line: number; label: string };
const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeSanitize];

/** A small optional reading aid. Code fences and indented code are not headings.
 * IDs use source lines, so repeated titles never collide within an answer. */
function sectionsFor(text: string): Section[] {
  if (text.length < 1800) return [];
  const sections: Section[] = [];
  let fence: { marker: string; size: number } | null = null;
  text.split('\n').forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = { marker: marker[0], size: marker.length };
      else if (fence.marker === marker[0] && marker.length >= fence.size && /^ {0,3}(?:`+|~+)\s*$/.test(line)) fence = null;
      return;
    }
    if (fence) return;
    const heading = /^ {0,3}#{1,4}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) return;
    const label = heading[1].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').trim();
    if (label) sections.push({ line: index + 1, label });
  });
  return sections.length >= 3 ? sections.slice(0, 16) : [];
}

/** The parser only sees a bounded number of intermediate updates. Completed
 * responses always render the exact final source immediately, with no synthetic
 * closing delimiters or mutation of escaped/code asterisks. */
function useStreamingText(text: string, streaming: boolean) {
  const [snapshot, setSnapshot] = React.useState(text);
  const latest = React.useRef(text);
  React.useEffect(() => { latest.current = text; }, [text]);
  React.useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => setSnapshot(current => current === latest.current ? current : latest.current), 80);
    return () => window.clearInterval(timer);
  }, [streaming]);
  return streaming && text ? snapshot : text;
}

const MarkdownBody = React.memo(function MarkdownBody({ text, prefix }: { text: string; prefix: string }) {
  const components = React.useMemo<Components>(() => {
    const heading = (tag: 'h2' | 'h3' | 'h4' | 'h5' | 'h6'): Components['h2'] => function AnswerHeading({ children, node }) {
      return React.createElement(tag, { id: `${prefix}-section-${node?.position?.start.line ?? 0}`, tabIndex: -1 }, children);
    };
    return {
      // The workspace owns its page/dialog heading; generated content cannot
      // introduce another top-level application heading.
      h1: heading('h2'), h2: heading('h3'), h3: heading('h4'), h4: heading('h5'), h5: heading('h6'), h6: heading('h6'),
      a: ({ href, children, title }) => href
        ? <a href={href} title={title} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a>
        : <span>{children}</span>,
      // A model-supplied image must never cause an automatic third-party request.
      // Approved building photos retain their existing authenticated component.
      img: ({ alt }) => alt ? <span className={styles.imageDescription}>{alt}</span> : null,
      table: ({ children }) => <div className={styles.tableScroll} role="region" aria-label="回答中的表格，可横向滚动" tabIndex={0}><table>{children}</table></div>,
      pre: ({ children }) => <pre tabIndex={0} aria-label="代码块，可横向滚动">{children}</pre>,
    };
  }, [prefix]);
  return <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}
    components={components} skipHtml urlTransform={defaultUrlTransform}>{text}</ReactMarkdown>;
});

export const HomeQueryMarkdown = React.memo(function HomeQueryMarkdown({ text, streaming = false,
  navigation = true, className = '', 'aria-label': label }: Props) {
  const prefix = React.useId();
  const rendered = useStreamingText(text, streaming);
  const sections = React.useMemo(() => navigation && !streaming ? sectionsFor(text) : [], [text, navigation, streaming]);
  return <div className={`${styles.root} ${className}`} aria-label={label} aria-busy={streaming || undefined}>
    {sections.length > 0 && <details className={styles.outline} onKeyDown={event => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false;
      event.currentTarget.querySelector('summary')?.focus({ preventScroll: true });
    }}>
      <summary>回答目录</summary>
      <nav aria-label="回答目录">{sections.map(section => <button key={section.line} type="button" onClick={() => {
        const target = document.getElementById(`${prefix}-section-${section.line}`);
        target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'start', behavior: 'auto' });
      }}>{section.label}</button>)}</nav>
    </details>}
    <MarkdownBody text={rendered} prefix={prefix} />
  </div>;
});
