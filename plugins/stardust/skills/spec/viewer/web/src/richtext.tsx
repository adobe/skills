// Rich text: renders markdown (chat answers, generated views) and authored HTML snippets (findings)
// as React elements with S2 typography applied per element. Nothing is injected as raw HTML.
// This stands in for the `prose()` macro of @react-spectrum/ai, whose 0.4.0 build fails at macro
// evaluation ("fontSize is not defined"); switch back to prose() once that is fixed.
import { Fragment, type ReactNode } from 'react';
import { marked, type Token, type Tokens } from 'marked';
import { Divider } from '@react-spectrum/s2/Divider';
import { Link } from '@react-spectrum/s2/Link';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };

export const rich = {
  flow: style({ display: 'flex', flexDirection: 'column', gap: 12, font: 'body', minWidth: 0 }),
  p: style({ font: 'body', margin: 0 }),
  h1: style({ font: 'heading-sm', margin: 0, marginTop: 8 }),
  h2: style({ font: 'title-lg', margin: 0, marginTop: 8 }),
  h3: style({ font: 'title', margin: 0, marginTop: 4 }),
  ul: style({ font: 'body', margin: 0, paddingStart: 20, listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: 4 }),
  ol: style({ font: 'body', margin: 0, paddingStart: 20, listStyleType: 'decimal', display: 'flex', flexDirection: 'column', gap: 4 }),
  strong: style({ fontWeight: 'bold' }),
  code: style({ font: 'code-sm', backgroundColor: 'gray-100', paddingX: 4, borderRadius: 'sm' }),
  pre: style({ font: 'code-sm', backgroundColor: 'layer-2', padding: 12, borderRadius: 'default', margin: 0, overflowX: 'auto', whiteSpace: 'pre-wrap' }),
  quote: style({ margin: 0, paddingStart: 12, borderStartWidth: 4, borderStyle: 'solid', borderColor: 'gray-300', borderTopWidth: 0, borderBottomWidth: 0, borderEndWidth: 0, color: 'neutral-subdued' }),
  tableWrap: style({ overflowX: 'auto', maxWidth: 'full' }),
  table: style({ borderCollapse: 'collapse', font: 'ui-sm', minWidth: 'full' }),
  th: style({ font: 'ui-sm', fontWeight: 'bold', textAlign: 'start', paddingX: 8, paddingY: 4, borderBottomWidth: 2, borderStyle: 'solid', borderColor: 'gray-300', borderTopWidth: 0, borderStartWidth: 0, borderEndWidth: 0 }),
  td: style({ font: 'ui-sm', paddingX: 8, paddingY: 4, borderBottomWidth: 1, borderStyle: 'solid', borderColor: 'gray-200', borderTopWidth: 0, borderStartWidth: 0, borderEndWidth: 0, verticalAlign: 'top' }),
};

const isExternal = (href: string) => /^https?:\/\//.test(href) && !href.startsWith(window.location.origin);

function RichLink({ href, children }: { href: string; children: ReactNode }) {
  // /api and /media are served by the Worker, not the router
  const native = isExternal(href) || href.startsWith('/api/') || href.startsWith('/media/');
  return <Link href={href} target={native ? '_blank' : undefined} rel={native ? 'noreferrer' : undefined}>{children}</Link>;
}

function inline(tokens: Token[] | undefined, key: string): ReactNode[] {
  return (tokens ?? []).map((t, i) => {
    const k = `${key}.${i}`;
    switch (t.type) {
      case 'text': return 'tokens' in t && t.tokens?.length ? <Fragment key={k}>{inline(t.tokens, k)}</Fragment> : <Fragment key={k}>{(t as Tokens.Text).text}</Fragment>;
      case 'escape': return <Fragment key={k}>{(t as Tokens.Escape).text}</Fragment>;
      case 'strong': return <strong key={k} className={rich.strong}>{inline((t as Tokens.Strong).tokens, k)}</strong>;
      case 'em': return <em key={k}>{inline((t as Tokens.Em).tokens, k)}</em>;
      case 'del': return <del key={k}>{inline((t as Tokens.Del).tokens, k)}</del>;
      case 'codespan': return <code key={k} className={rich.code}>{(t as Tokens.Codespan).text}</code>;
      case 'link': return <RichLink key={k} href={(t as Tokens.Link).href}>{inline((t as Tokens.Link).tokens, k)}</RichLink>;
      case 'br': return <br key={k} />;
      case 'html': return /^<br\s*\/?>$/i.test((t as Tokens.HTML).text.trim()) ? <br key={k} /> : null;
      default: return 'text' in t ? <Fragment key={k}>{String((t as { text: string }).text)}</Fragment> : null;
    }
  });
}

function blocks(tokens: Token[], key: string): ReactNode[] {
  return tokens.map((t, i) => {
    const k = `${key}.${i}`;
    switch (t.type) {
      case 'paragraph': return <p key={k} className={rich.p}>{inline((t as Tokens.Paragraph).tokens, k)}</p>;
      case 'heading': {
        const h = t as Tokens.Heading;
        if (h.depth <= 1) return <h3 key={k} className={rich.h1}>{inline(h.tokens, k)}</h3>;
        if (h.depth === 2) return <h4 key={k} className={rich.h2}>{inline(h.tokens, k)}</h4>;
        return <h5 key={k} className={rich.h3}>{inline(h.tokens, k)}</h5>;
      }
      case 'list': {
        const l = t as Tokens.List;
        const items = l.items.map((it, j) => <li key={j}>{blocks(it.tokens, `${k}.${j}`)}</li>);
        return l.ordered ? <ol key={k} className={rich.ol} start={l.start || undefined}>{items}</ol> : <ul key={k} className={rich.ul}>{items}</ul>;
      }
      case 'text': return <Fragment key={k}>{inline((t as Tokens.Text).tokens ?? [{ type: 'text', raw: '', text: (t as Tokens.Text).text } as Token], k)}</Fragment>;
      case 'code': return <pre key={k} className={rich.pre}>{(t as Tokens.Code).text}</pre>;
      case 'blockquote': return <blockquote key={k} className={rich.quote}>{blocks((t as Tokens.Blockquote).tokens, k)}</blockquote>;
      case 'hr': return <Divider key={k} size="S" />;
      case 'table': {
        const tb = t as Tokens.Table;
        return (
          <div key={k} className={rich.tableWrap}>
            <table className={rich.table}>
              <thead><tr>{tb.header.map((c, j) => <th key={j} scope="col" className={rich.th}>{inline(c.tokens, `${k}.h${j}`)}</th>)}</tr></thead>
              <tbody>{tb.rows.map((row, r) => <tr key={r}>{row.map((c, j) => <td key={j} className={rich.td}>{inline(c.tokens, `${k}.${r}.${j}`)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      }
      default: return null; // space, raw html blocks
    }
  });
}

export function Markdown({ source }: { source: string }) {
  return <div className={rich.flow}>{blocks(marked.lexer(source ?? ''), 'md')}</div>;
}

// Authored HTML snippets: keep links and inline emphasis, drop everything else to text.
function fromDom(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const kids = [...el.childNodes].map((c, i) => fromDom(c, `${key}.${i}`));
  switch (el.tagName.toLowerCase()) {
    case 'a': return <RichLink key={key} href={el.getAttribute('href') ?? '#'}>{kids}</RichLink>;
    case 'b': case 'strong': return <strong key={key} className={rich.strong}>{kids}</strong>;
    case 'i': case 'em': return <em key={key}>{kids}</em>;
    case 'code': return <code key={key} className={rich.code}>{kids}</code>;
    case 'br': return <br key={key} />;
    default: return <Fragment key={key}>{kids}</Fragment>;
  }
}

export function RichHtml({ html }: { html: string }) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return <>{[...doc.body.childNodes].map((n, i) => fromDom(n, `h${i}`))}</>;
}
