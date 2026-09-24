import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import type { YItem } from '@shared/schema';
import { useWorkspace } from '../../workspace/context';
import { useSession, resolvedTheme } from '../../store/session';
import { alpha } from '../../lib/util';
import { CursorLayer } from '../../components/Cursors';
import { loadLanguage } from './languages';

interface Props {
  file: YItem;
  readOnly: boolean;
  wrap: boolean;
  tabSize: number;
  onCursor: (line: number, col: number, selected: number) => void;
  onRun: () => void;
}

const lightTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface)', color: 'var(--text)' },
  '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--text-3)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'var(--code-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--code-active-line)' },
});

function themeExtension(dark: boolean): Extension {
  return dark ? [oneDark] : [lightTheme, syntaxHighlighting(defaultHighlightStyle, { fallback: true })];
}

/** CodeMirror 6 + Yjs: 여러 사람이 같은 파일을 동시에 편집 */
export function CodeEditor({ file, readOnly, wrap, tabSize, onCursor, onRun }: Props) {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const theme = useSession((s) => s.theme);
  const hostRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [ready, setReady] = useState(false);
  const [systemDark, setSystemDark] = useState(() => resolvedTheme('system') === 'dark');
  const dark = theme === 'system' ? systemDark : theme === 'dark';

  const c = useMemo(
    () => ({ lang: new Compartment(), theme: new Compartment(), wrap: new Compartment(), ro: new Compartment(), tab: new Compartment() }),
    [],
  );
  const cb = useRef({ onCursor, onRun });
  cb.current = { onCursor, onRun };
  const wsRef = useRef(ws);
  wsRef.current = ws;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // 에디터 생성 (파일이 바뀌면 새로 만든다)
  useEffect(() => {
    const ytext = file.get('content') as Y.Text;
    const fileId = file.get('id') as string;
    const undoManager = new Y.UndoManager(ytext);
    const awareness = ws.provider.awareness;
    awareness.setLocalStateField('user', { name: `${me.avatar} ${me.name}`, color: me.color, colorLight: alpha(me.color, 0.25) });

    const view = new EditorView({
      parent: mountRef.current!,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([
            { key: 'Mod-Enter', run: () => (cb.current.onRun(), true) },
            ...yUndoManagerKeymap,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...foldKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          c.lang.of([]),
          c.theme.of(themeExtension(dark)),
          c.wrap.of(wrap ? EditorView.lineWrapping : []),
          c.ro.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          c.tab.of([EditorState.tabSize.of(tabSize), indentUnit.of(' '.repeat(tabSize))]),
          yCollab(ytext, awareness, { undoManager }),
          EditorView.updateListener.of((u) => {
            if (u.selectionSet || u.docChanged) {
              const sel = u.state.selection.main;
              const line = u.state.doc.lineAt(sel.head);
              cb.current.onCursor(line.number, sel.head - line.from + 1, Math.abs(sel.to - sel.from));
            }
            const local = u.transactions.some(
              (tr) => tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('undo') || tr.isUserEvent('redo') || tr.isUserEvent('move'),
            );
            const w = wsRef.current;
            if (u.docChanged && local) {
              w.action('⌨️ 코드 입력 중');
              w.report({ type: 'code.edit', targetId: fileId, targetName: String(file.get('name')) });
            } else if (u.selectionSet && u.transactions.some((tr) => tr.isUserEvent('select')) && !u.state.selection.main.empty) {
              w.action('🔍 코드 선택 중');
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    anchorRef.current = view.contentDOM;
    scrollRef.current = view.scrollDOM;
    setReady(true);

    // 다른 사람이 언어를 바꾸면 문법 강조를 바꾼다
    let lang = file.get('language') as string;
    let cancelled = false;
    const applyLanguage = () =>
      loadLanguage(lang).then((ext) => {
        if (!cancelled) view.dispatch({ effects: c.lang.reconfigure(ext) });
      });
    void applyLanguage();
    const onMeta = (e: Y.YMapEvent<unknown>) => {
      if (e.keysChanged.has('language')) {
        lang = file.get('language') as string;
        void applyLanguage();
      }
    };
    file.observe(onMeta);

    return () => {
      cancelled = true;
      file.unobserve(onMeta);
      setReady(false);
      view.destroy();
      undoManager.destroy();
      viewRef.current = null;
      // 이 파일에서 떠나면 다른 사람 화면의 내 캐럿도 지운다
      awareness.setLocalStateField('cursor', null);
    };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    viewRef.current?.dispatch({ effects: c.theme.reconfigure(themeExtension(dark)) });
  }, [dark, c]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: c.wrap.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap, c]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: c.ro.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly, c]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: c.tab.reconfigure([EditorState.tabSize.of(tabSize), indentUnit.of(' '.repeat(tabSize))]) });
  }, [tabSize, c]);

  return (
    <div className="cursor-host code-host" ref={hostRef}>
      <div className="code-mount" ref={mountRef} />
      {ready && <CursorLayer key={file.get('id') as string} hostRef={hostRef} anchorRef={anchorRef} scrollRef={scrollRef} xMode="px" />}
    </div>
  );
}
