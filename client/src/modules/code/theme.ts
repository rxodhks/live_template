/*
 * 코드 편집기 테마 — 요즘 IDE(VS Code · GitHub) 느낌의 밝은 · 어두운 색
 * 바탕은 앱 화면 색(var(--surface))을 그대로 써서 편집기만 따로 떠 보이지 않게 한다.
 */
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';

interface Palette {
  keyword: string;
  control: string;
  string: string;
  number: string;
  fn: string;
  type: string;
  property: string;
  variable: string;
  comment: string;
  tag: string;
  attr: string;
  regexp: string;
  heading: string;
  invalid: string;
}

// GitHub Light 바탕
const LIGHT: Palette = {
  keyword: '#cf222e',
  control: '#cf222e',
  string: '#0a3069',
  number: '#0550ae',
  fn: '#8250df',
  type: '#953800',
  property: '#0550ae',
  variable: '#1f2328',
  comment: '#6e7781',
  tag: '#116329',
  attr: '#0550ae',
  regexp: '#116329',
  heading: '#0550ae',
  invalid: '#82071e',
};

// GitHub Dark 바탕
const DARK: Palette = {
  keyword: '#ff7b72',
  control: '#ff7b72',
  string: '#a5d6ff',
  number: '#79c0ff',
  fn: '#d2a8ff',
  type: '#ffa657',
  property: '#79c0ff',
  variable: '#e6edf3',
  comment: '#8b949e',
  tag: '#7ee787',
  attr: '#79c0ff',
  regexp: '#7ee787',
  heading: '#79c0ff',
  invalid: '#ffa198',
};

function highlight(p: Palette) {
  return HighlightStyle.define([
    { tag: [t.keyword, t.modifier, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: p.keyword },
    { tag: [t.controlKeyword], color: p.control },
    { tag: [t.string, t.special(t.string), t.character, t.docString], color: p.string },
    { tag: [t.regexp, t.escape], color: p.regexp },
    { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.unit], color: p.number },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName)), t.macroName], color: p.fn },
    { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName), t.annotation, t.self], color: p.type },
    { tag: [t.propertyName, t.definition(t.propertyName), t.labelName], color: p.property },
    { tag: [t.constant(t.variableName), t.standard(t.variableName)], color: p.number },
    { tag: [t.variableName, t.definition(t.variableName)], color: p.variable },
    { tag: [t.comment, t.lineComment, t.blockComment, t.meta], color: p.comment, fontStyle: 'italic' },
    { tag: [t.tagName, t.angleBracket], color: p.tag },
    { tag: [t.attributeName], color: p.attr },
    { tag: [t.attributeValue], color: p.string },
    { tag: [t.heading], color: p.heading, fontWeight: '700' },
    { tag: t.strong, fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.link, color: p.string, textDecoration: 'underline' },
    { tag: t.invalid, color: p.invalid },
  ]);
}

function base(dark: boolean) {
  return EditorView.theme(
    {
      '&': { backgroundColor: 'var(--surface)', color: 'var(--text)' },
      '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
      '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent)' },
      // 선택 영역: 강조색을 옅게
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'var(--code-selection) !important',
      },
      '.cm-selectionMatch': { backgroundColor: 'var(--code-match)' },
      '.cm-searchMatch': { backgroundColor: 'var(--code-match)', outline: '1px solid var(--code-match-border)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--code-selection)' },
      '&.cm-focused .cm-matchingBracket': { backgroundColor: 'transparent', outline: '1px solid var(--code-bracket)', borderRadius: '2px' },
      '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--danger-soft)' },
      '.cm-activeLine': { backgroundColor: 'var(--code-active-line)' },
      // 줄 번호: 칸막이 선 없이 흐리게, 지금 줄만 진하게
      '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--code-gutter)', border: 'none' },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 16px', minWidth: '44px' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
      '.cm-foldPlaceholder': { backgroundColor: 'var(--surface-3)', border: 'none', color: 'var(--text-2)', borderRadius: '4px', padding: '0 6px' },
      // 말풍선 · 자동 완성 · 검색창
      '.cm-tooltip': {
        backgroundColor: 'var(--surface)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        boxShadow: 'var(--shadow-lg)',
      },
      // 자동 완성 옆 설명(타입 · 문서)이 목록 밖에 붙어 보이도록 목록 상자는 잘라 내지 않는다
      '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--mono)', padding: '4px', maxHeight: '16em', borderRadius: '8px' },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { borderRadius: '5px', padding: '2px 8px 2px 4px', lineHeight: '1.6' },
      '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--text)' },
      '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--accent-text)', fontWeight: '700' },
      '.cm-completionDetail': { color: 'var(--text-3)', fontStyle: 'normal', marginLeft: '1em' },
      '.cm-completionIcon': { opacity: '0.8' },
      '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)' },
      '.cm-panels-top': { borderBottom: '1px solid var(--border)' },
      '.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
      '.cm-panel.cm-search': { padding: '6px 10px', fontFamily: 'var(--font)', fontSize: '12.5px' },
      '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontFamily: 'inherit', fontSize: 'inherit', borderRadius: '6px' },
      '.cm-panel.cm-search input.cm-textfield': {
        border: '1px solid var(--border)',
        backgroundColor: 'var(--surface)',
        color: 'var(--text)',
        padding: '3px 8px',
      },
      '.cm-panel.cm-search input.cm-textfield:focus': { outline: '2px solid var(--accent)', outlineOffset: '-1px' },
      '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' },
    },
    { dark },
  );
}

/** 들여쓰기 안내선 (VS Code 처럼, 지금 블록의 선만 진하게) */
const guides = indentationMarkers({
  thickness: 1,
  markerType: 'codeOnly',
  colors: {
    light: 'var(--code-guide)',
    dark: 'var(--code-guide)',
    activeLight: 'var(--code-guide-active)',
    activeDark: 'var(--code-guide-active)',
  },
});

const lightExt: Extension = [base(false), syntaxHighlighting(highlight(LIGHT)), guides];
const darkExt: Extension = [base(true), syntaxHighlighting(highlight(DARK)), guides];

export const editorTheme = (dark: boolean): Extension => (dark ? darkExt : lightExt);
