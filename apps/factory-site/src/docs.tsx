import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Info, Search } from 'lucide-react';
import { marked, type Token, type Tokens } from 'marked';
import { CodeBlock, text, type Lang } from './shared';

const sections = [
  ['start', 'Bắt đầu', 'Getting started'], ['concepts', 'Khái niệm', 'Concepts'], ['guides', 'Hướng dẫn', 'Guides'],
  ['extensions', 'Tiện ích mở rộng', 'Extensions'], ['reference', 'Tham chiếu', 'Reference'],
] as const;

type Page = { slug: string; lang: Lang; title: string; section: string; order: number; body: string };
const files = import.meta.glob<string>('../docs/*/*.md', { query: '?raw', eager: true, import: 'default' });
const pages = Object.entries(files).map(([path, source]): Page => {
  const [, lang, filename] = /\/docs\/(vi|en)\/([a-z0-9-]+)\.md$/.exec(path)!;
  const [, frontmatter, body] = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source)!;
  const fields = Object.fromEntries(frontmatter.split(/\r?\n/).map((line) => {
    const separator = line.indexOf(':');
    return [line.slice(0, separator), line.slice(separator + 1).trim()];
  }));
  return { slug: filename, lang: lang as Lang, title: fields.title, section: fields.section, order: Number(fields.order), body };
});

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replaceAll('đ', 'd');
const headingId = (value: string) => normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pageLink = (slug: string, anchor?: string) => `#/docs/${slug}${anchor ? `#${anchor}` : ''}`;
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

marked.use({ renderer: {
  html() { return ''; },
  link({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens);
    const relative = /^(?:\.\/)?([a-z0-9-]+)(?:\.md)?(?:#([a-z0-9-]+))?$/.exec(href);
    const url = relative ? pageLink(relative[1], relative[2]) : /^https?:\/\/[^\s]+$/i.test(href) ? href : null;
    return url ? `<a href="${escape(url)}"${title ? ` title="${escape(title)}"` : ''}>${label}</a>` : label;
  },
  image({ href, title, text: alt }) {
    const image = /^(?:\.\.\/|\.\/)*images\/([a-z0-9.-]+\.(?:png|jpe?g|webp|svg))$/i.exec(href);
    return image ? `<img src="/images/${escape(image[1])}" alt="${escape(alt)}" loading="lazy"${title ? ` title="${escape(title)}"` : ''}>` : escape(alt);
  },
} });

function safeHtml(tokens: Parameters<typeof marked.parser>[0]) {
  return { __html: marked.parser(tokens) };
}

function isHeading(token: { type: string; depth?: number }): token is Tokens.Heading {
  return token.type === 'heading' && token.depth !== undefined && token.depth >= 2;
}

export function Docs({ slug, lang }: { slug: string; lang: Lang }) {
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const docsLabel = text(lang, 'Tài liệu', 'Docs');
  const ordered = pages.filter((page) => page.lang === 'vi').sort((left, right) =>
    sections.findIndex(([section]) => section === left.section) - sections.findIndex(([section]) => section === right.section) || left.order - right.order,
  ).map((page) => pages.find((candidate) => candidate.slug === page.slug && candidate.lang === lang) ?? page);
  const page = ordered.find((candidate) => candidate.slug === slug);
  const index = ordered.findIndex((candidate) => candidate.slug === slug);
  const tokens: Token[] = page ? marked.lexer(page.body) : [];
  const matching = ordered.filter((candidate) => normalize(candidate.title).includes(normalize(query.trim())));
  const usedIds = new Set<string>();
  const headingIds = new Map(tokens.filter(isHeading).map((heading) => {
    const base = headingId(heading.text) || 'section';
    let id = base;
    for (let suffix = 2; usedIds.has(id); suffix++) id = `${base}-${suffix}`;
    usedIds.add(id);
    return [heading, id];
  }));

  const title = page?.title ?? text(lang, 'Không tìm thấy tài liệu', 'Document not found');
  useEffect(() => { document.title = `${title} · Factory`; }, [title]);
  useEffect(() => {
    const anchor = location.hash.slice(1).split('#', 2)[1];
    if (anchor) document.getElementById(anchor)?.scrollIntoView();
  }, [lang]);

  return <div className="wrap docs-layout">
    <aside className="docs-sidebar">
      <div className="docs-brand"><BookOpen size={19} aria-hidden="true" />{docsLabel}</div>
      <button type="button" className="docs-menu" aria-expanded={menuOpen} aria-controls="docs-side-content" onClick={() => setMenuOpen(!menuOpen)}><BookOpen size={19} aria-hidden="true" />{text(lang, 'Danh mục tài liệu', 'Browse docs')}</button>
      <div className={menuOpen ? 'docs-side-content open' : 'docs-side-content'} id="docs-side-content">
      <label className="docs-search"><Search size={17} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text(lang, 'Tìm theo tiêu đề…', 'Search titles…')} aria-label={text(lang, 'Tìm theo tiêu đề tài liệu', 'Search documentation titles')} /></label>
      <nav aria-label={text(lang, 'Điều hướng tài liệu', 'Documentation navigation')}>
        {!matching.length && <p role="status">{text(lang, 'Không tìm thấy trang.', 'No pages found.')}</p>}
        {sections.map(([section, vi, en]) => {
          const items = matching.filter((candidate) => candidate.section === section);
          return items.length ? <div className="docs-group" key={section}><h2>{text(lang, vi, en)}</h2><ul>{items.map((item) =>
            <li key={item.slug}><a lang={item.lang} aria-current={item.slug === slug ? 'page' : undefined} href={pageLink(item.slug)}>{item.title}</a></li>,
          )}</ul></div> : null;
        })}
      </nav>
      </div>
    </aside>
    {page ? <article className="docs-article" lang={page.lang}>
      <header className="docs-title"><p className="eyebrow" lang={lang}>{docsLabel} / {sections.find(([section]) => section === page.section)?.[lang === 'vi' ? 1 : 2]}</p><h1>{title}</h1></header>
      {page.lang !== lang && <aside className="callout" lang={lang}><Info size={20} aria-hidden="true" /><p>{text(lang, 'Trang này chưa có bản dịch.', 'This page is not yet available in English.')}</p></aside>}
      <div className="prose">{tokens.map((token, tokenIndex) => {
        if (isHeading(token)) {
          const Heading = `h${token.depth}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
          return <Heading id={headingIds.get(token)} key={tokenIndex} dangerouslySetInnerHTML={{ __html: marked.parseInline(token.text, { async: false }) }} />;
        }
        if (token.type === 'code') return <CodeBlock key={tokenIndex} value={token.text} label={token.lang || text(page.lang, 'Văn bản', 'Text')} lang={page.lang} />;
        if (token.type === 'blockquote') return <aside className="callout" key={tokenIndex}><Info size={20} aria-hidden="true" /><div dangerouslySetInnerHTML={safeHtml(token.tokens ?? [])} /></aside>;
        if (token.type === 'space') return null;
        return <div className={token.type === 'table' ? 'table-scroll' : undefined} key={tokenIndex} dangerouslySetInnerHTML={safeHtml([token])} />;
      })}</div>
      <nav className="docs-pagination" lang={lang} aria-label={text(lang, 'Trang trước và sau', 'Previous and next pages')}>
        {[ordered[index - 1], ordered[index + 1]].map((neighbor, position) => neighbor ? <a href={pageLink(neighbor.slug)} key={neighbor.slug}>
          <span>{position === 0 ? <><ArrowLeft size={15} aria-hidden="true" />{text(lang, 'Trang trước', 'Previous')}</> : <>{text(lang, 'Trang sau', 'Next')}<ArrowRight size={15} aria-hidden="true" /></>}</span><strong lang={neighbor.lang}>{neighbor.title}</strong>
        </a> : <span key={position} />)}
      </nav>
    </article> : <div className="not-found"><h1>{title}</h1><a href={pageLink('introduction')}>{text(lang, 'Đọc giới thiệu', 'Read the introduction')}</a></div>}
    {page && headingIds.size > 0 && <nav className="docs-toc" aria-label={text(lang, 'Trên trang này', 'On this page')}>
      <h2>{text(lang, 'Trên trang này', 'On this page')}</h2><ul>{Array.from(headingIds, ([heading, id]) => <li key={id} className={heading.depth > 2 ? 'subheading' : undefined}>
        <a lang={page.lang} href={pageLink(slug, id)}>{heading.text.replace(/`/g, '')}</a></li>)}</ul>
    </nav>}
  </div>;
}
