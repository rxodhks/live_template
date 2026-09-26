import type { JSONContent } from '@tiptap/core';
import type { PageSetup } from '@shared/schema';
import { DOC_COLORS, DOC_COLOR_CSS } from '../modules/docs/blocks/colors';
import { pageCss, toPx } from '../modules/docs/page/pageSizes';

/* TipTap JSON → Markdown (내보내기용) */

function marks(text: string, node: JSONContent): string {
  let out = text;
  for (const m of node.marks ?? []) {
    switch (m.type) {
      case 'bold':
        out = `**${out}**`;
        break;
      case 'italic':
        out = `*${out}*`;
        break;
      case 'strike':
        out = `~~${out}~~`;
        break;
      case 'code':
        out = `\`${out}\``;
        break;
      case 'highlight':
        out = `==${out}==`;
        break;
      case 'underline':
        out = `<u>${out}</u>`;
        break;
      case 'link':
        out = `[${out}](${m.attrs?.href ?? ''})`;
        break;
    }
  }
  return out;
}

function inline(nodes: JSONContent[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'text') return marks(n.text ?? '', n);
      if (n.type === 'hardBreak') return '  \n';
      if (n.type === 'inlineMath') return `$${n.attrs?.latex ?? ''}$`;
      if (n.type === 'mention') return mentionText(n);
      return inline(n.content);
    })
    .join('');
}

/** 멘션: 사람 · 날짜는 @이름, 페이지는 이름 그대로 */
function mentionText(n: JSONContent): string {
  const id = String(n.attrs?.id ?? '');
  const label = String(n.attrs?.label ?? id);
  return id.startsWith('p:') ? label : `@${label}`;
}

/** 여러 블록을 이어 붙인 뒤 줄마다 앞에 붙이기 (인용 · 콜아웃) */
const prefixLines = (text: string, prefix: string) =>
  text
    .split('\n')
    .map((l) => (l ? `${prefix}${l}` : prefix.trimEnd()))
    .join('\n');

const blocks = (nodes: JSONContent[] = [], indent = '') => nodes.map((x) => block(x, indent)).join('\n\n');

/** 문서 전체의 제목들 (목차 블록 내보내기용) */
let headingsForToc: { level: number; text: string }[] = [];
function collectHeadings(node: JSONContent, out: { level: number; text: string }[]) {
  if (node.type === 'heading') out.push({ level: Number(node.attrs?.level ?? 1), text: inline(node.content).replace(/[*_`~=]/g, '') });
  else for (const c of node.content ?? []) collectHeadings(c, out);
}

function block(node: JSONContent, indent = ''): string {
  const c = node.content ?? [];
  switch (node.type) {
    case 'callout':
      return prefixLines(`${node.attrs?.emoji ?? '💡'} ${blocks(c)}`, '> ');
    case 'details': {
      const summary = c.find((x) => x.type === 'detailsSummary');
      const body = c.find((x) => x.type === 'detailsContent');
      return `<details${node.attrs?.open ? ' open' : ''}>\n<summary>${inline(summary?.content)}</summary>\n\n${blocks(body?.content)}\n\n</details>`;
    }
    case 'columns':
      return c.map((col) => blocks(col.content)).join('\n\n');
    case 'image': {
      const alt = String(node.attrs?.caption || node.attrs?.alt || '이미지').replace(/[[\]]/g, '');
      const img = `![${alt}](${node.attrs?.src ?? ''})`;
      return node.attrs?.caption ? `${img}\n*${node.attrs.caption}*` : img;
    }
    case 'embed':
      return `[${node.attrs?.provider ?? '임베드'}: ${node.attrs?.url || node.attrs?.src}](${node.attrs?.url || node.attrs?.src})`;
    case 'pageBreak':
      return '<div style="page-break-after: always"></div>';
    case 'blockMath':
      return `$$\n${node.attrs?.latex ?? ''}\n$$`;
    case 'tableOfContents': {
      if (!headingsForToc.length) return '';
      const min = Math.min(...headingsForToc.map((h) => h.level));
      return headingsForToc.map((h) => `${'  '.repeat(h.level - min)}- ${h.text}`).join('\n');
    }
    case 'heading':
      return `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${inline(c)}`;
    case 'paragraph':
      return indent + inline(c);
    case 'blockquote':
      return prefixLines(blocks(c), '> ');
    case 'codeBlock':
      return `\`\`\`${node.attrs?.language ?? ''}\n${c.map((x) => x.text ?? '').join('')}\n\`\`\``;
    case 'horizontalRule':
      return '---';
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return c
        .map((item, i) => {
          const bullet =
            node.type === 'orderedList'
              ? `${Number(node.attrs?.start ?? 1) + i}.`
              : node.type === 'taskList'
                ? `- [${item.attrs?.checked ? 'x' : ' '}]`
                : '-';
          const [first, ...rest] = item.content ?? [];
          const head = `${indent}${bullet} ${first ? inline(first.content) : ''}`;
          const tail = rest.map((r) => block(r, `${indent}  `)).join('\n');
          return tail ? `${head}\n${tail}` : head;
        })
        .join('\n');
    case 'table': {
      const rows = c.map((row) => (row.content ?? []).map((cell) => (cell.content ?? []).map((p) => inline(p.content)).join(' ').replace(/\|/g, '\\|')));
      if (!rows.length) return '';
      const header = `| ${rows[0].join(' | ')} |`;
      const sep = `| ${rows[0].map(() => '---').join(' | ')} |`;
      return [header, sep, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n');
    }
    default:
      return inline(c);
  }
}

export function toMarkdown(doc: JSONContent, title?: string): string {
  headingsForToc = [];
  collectHeadings(doc, headingsForToc);
  const body = (doc.content ?? []).map((n) => block(n)).join('\n\n');
  return `${title ? `# ${title}\n\n` : ''}${body}\n`;
}

/**
 * 내보내는 HTML 다듬기: 수식은 KaTeX로 그려 넣고, 목차 블록은 제목 목록으로 채운다
 * (편집기 밖에서도 그대로 보이도록)
 */
async function finishHtml(bodyHtml: string): Promise<string> {
  const dom = new DOMParser().parseFromString(`<body>${bodyHtml}</body>`, 'text/html');
  const maths = dom.querySelectorAll<HTMLElement>('[data-type="block-math"], [data-type="inline-math"]');
  if (maths.length) {
    const katex = (await import('katex')).default;
    maths.forEach((el) => {
      const display = el.dataset.type === 'block-math';
      el.innerHTML = katex.renderToString(el.dataset.latex ?? '', { displayMode: display, throwOnError: false });
    });
  }
  const headings = Array.from(dom.body.querySelectorAll('h1, h2, h3'));
  headings.forEach((h, i) => (h.id = `h-${i + 1}`));
  dom.querySelectorAll('nav[data-toc]').forEach((nav) => {
    const min = Math.min(...headings.map((h) => Number(h.tagName[1])));
    nav.innerHTML = `<strong>목차</strong><ol>${headings
      .map((h) => `<li style="margin-left:${(Number(h.tagName[1]) - min) * 16}px"><a href="#${h.id}">${h.textContent?.replace(/</g, '&lt;') ?? ''}</a></li>`)
      .join('')}</ol>`;
  });
  dom.querySelectorAll('div[data-embed]').forEach((el) => {
    const e = el as HTMLElement;
    if (!e.dataset.src) return;
    const h = Number(e.dataset.height);
    e.innerHTML = `<iframe src="${e.dataset.src.replace(/"/g, '&quot;')}" style="width:100%;${h > 0 ? `height:${h}px` : 'aspect-ratio:16/9'};border:0" allowfullscreen loading="lazy"></iframe>`;
  });
  return dom.body.innerHTML;
}

export async function toHtmlDocument(title: string, bodyHtml: string, page?: PageSetup | null): Promise<string> {
  const body = await finishHtml(bodyHtml);
  // 크기가 정해진 문서: 본문 너비 · 글자 크기 · 인쇄 크기를 그대로
  const paged = page
    ? `body { max-width: ${Math.round(toPx(page.width - 2 * page.margin, page.unit))}px; font-size: ${page.fontSize}px; }\n${pageCss(page)}\n.doc-content > *, body > * { break-inside: avoid; }`
    : '';
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${title.replace(/</g, '&lt;')}</title>
<style>
body { font-family: Pretendard, system-ui, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; line-height: 1.7; color: #1f2328; }
pre { background: #f6f8fa; padding: 12px 16px; border-radius: 8px; overflow: auto; }
code { background: #f1f3f5; padding: 1px 5px; border-radius: 4px; }
blockquote { border-left: 3px solid #d0d7de; margin: 0; padding-left: 14px; color: #57606a; }
table { border-collapse: collapse; } td, th { border: 1px solid #d0d7de; padding: 6px 10px; }
mark { background: #fff3a3; }
mark[data-color] { color: inherit; }
ul[data-type="taskList"] { list-style: none; padding-left: 4px; }
${DOC_COLOR_CSS}
.callout { display: flex; gap: 10px; padding: 12px 16px; border-radius: 8px; background: var(--dcb-gray); margin: 12px 0; }
${DOC_COLORS.map((c) => `.callout[data-color="${c.key}"] { background: var(--dcb-${c.key}); }`).join('\n')}
.callout-body > :first-child { margin-top: 0; } .callout-body > :last-child { margin-bottom: 0; }
details { margin: 8px 0; } summary { font-weight: 600; cursor: pointer; }
details > [data-type="detailsContent"] { padding-left: 20px; }
.doc-columns { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 24px; }
figure.doc-image { margin: 16px 0; text-align: center; } figure.doc-image[data-align="left"] { text-align: left; } figure.doc-image[data-align="right"] { text-align: right; }
figure.doc-image img { max-width: 100%; border-radius: 6px; } figcaption { font-size: 13px; color: #6b7280; margin-top: 6px; }
div[data-page-break] { break-after: page; height: 0; }
${paged}
nav[data-toc] { background: #f6f8fa; border-radius: 8px; padding: 10px 14px; } nav[data-toc] ol { list-style: none; padding: 0; margin: 6px 0 0; }
.mention { background: #eeeefd; color: #4f46e5; border-radius: 4px; padding: 0 3px; }
</style>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/katex.min.css" />
</head>
<body>
<h1>${title.replace(/</g, '&lt;')}</h1>
${body}
</body>
</html>`;
}
