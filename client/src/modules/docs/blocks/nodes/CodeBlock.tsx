import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { common, createLowlight } from 'lowlight';

export const lowlight = createLowlight(common);

/** 코드 블록 언어 (표시 이름) — lowlight 기본 언어 중 자주 쓰는 것 */
export const CODE_BLOCK_LANGUAGES: [id: string, name: string][] = [
  ['', '자동 감지'],
  ['plaintext', '일반 텍스트'],
  ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['python', 'Python'],
  ['java', 'Java'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['csharp', 'C#'],
  ['go', 'Go'],
  ['rust', 'Rust'],
  ['kotlin', 'Kotlin'],
  ['swift', 'Swift'],
  ['php', 'PHP'],
  ['ruby', 'Ruby'],
  ['sql', 'SQL'],
  ['bash', 'Shell'],
  ['json', 'JSON'],
  ['yaml', 'YAML'],
  ['xml', 'HTML · XML'],
  ['css', 'CSS'],
  ['scss', 'SCSS'],
  ['markdown', 'Markdown'],
  ['diff', 'Diff'],
  ['lua', 'Lua'],
  ['r', 'R'],
];

/** 코드 블록: 문법 색 + 언어 선택 (노드 이름 · 속성은 기존 codeBlock과 같아 예전 문서와 호환) */
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({ lowlight, defaultLanguage: null });

function CodeBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const language = (node.attrs.language as string | null) ?? '';
  const known = CODE_BLOCK_LANGUAGES.some(([id]) => id === language);
  return (
    <NodeViewWrapper className="doc-code">
      <select
        className="doc-code-lang"
        contentEditable={false}
        value={known ? language : ''}
        disabled={!editor.isEditable}
        aria-label="코드 언어"
        onChange={(e) => updateAttributes({ language: e.target.value || null })}
      >
        {CODE_BLOCK_LANGUAGES.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      <pre spellCheck={false}>
        <NodeViewContent<'code'> as="code" className={language ? `language-${language}` : undefined} />
      </pre>
    </NodeViewWrapper>
  );
}
