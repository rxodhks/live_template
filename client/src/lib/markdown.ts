import type { JSONContent } from '@tiptap/core';

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
      return inline(n.content);
    })
    .join('');
}

function block(node: JSONContent, indent = ''): string {
  const c = node.content ?? [];
  switch (node.type) {
    case 'heading':
      return `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${inline(c)}`;
    case 'paragraph':
      return indent + inline(c);
    case 'blockquote':
      return c.map((x) => block(x)).join('\n\n').split('\n').map((l) => `> ${l}`).join('\n');
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
  const body = (doc.content ?? []).map((n) => block(n)).join('\n\n');
  return `${title ? `# ${title}\n\n` : ''}${body}\n`;
}

export function toHtmlDocument(title: string, bodyHtml: string): string {
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
ul[data-type="taskList"] { list-style: none; padding-left: 4px; }
</style>
</head>
<body>
<h1>${title.replace(/</g, '&lt;')}</h1>
${bodyHtml}
</body>
</html>`;
}
