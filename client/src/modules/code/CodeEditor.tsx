import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
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
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { forceLinting, lintGutter, linter, openLintPanel, type Diagnostic } from '@codemirror/lint';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { getFiles, type YItem } from '@shared/schema';
import { useWorkspace } from '../../workspace/context';
import { useSession, resolvedTheme } from '../../store/session';
import { alpha } from '../../lib/util';
import { CursorLayer } from '../../components/Cursors';
import { loadLanguage } from './languages';
import { canCheck, checkCode, checkGroup } from './assist/assist';
import { editorTheme } from './theme';

/** 코드 검사 상태 (상태 표시줄) */
export type LintState = { loading: true } | { loading: false; errors: number; warnings: number; failed?: boolean };

/** 바깥(코드 화면)에서 편집기를 다루는 방법 */
export interface EditorApi {
  /** 줄(1부터) · 열로 이동해 가운데에 보여 준다 */
  goTo(line: number, col?: number): void;
  /** 내용 전체를 바꾼다 — 바뀐 부분만 고쳐서 커서 · 다른 사람 편집이 덜 흔들리게 */
  replaceAll(text: string): void;
  getText(): string;
  /** 문제(오류 · 경고) 목록 패널 열기 */
  openProblems(): void;
}

interface Props {
  file: YItem;
  readOnly: boolean;
  wrap: boolean;
  tabSize: number;
  /** 오류 밑줄 (JS · TS · 파이썬) */
  lint: boolean;
  apiRef: MutableRefObject<EditorApi | null>;
  onCursor: (line: number, col: number, selected: number) => void;
  onRun: () => void;
  onFormat: () => void;
  onLint: (s: LintState | null) => void;
}

/** CodeMirror 6 + Yjs: 여러 사람이 같은 파일을 동시에 편집 */
export function CodeEditor({ file, readOnly, wrap, tabSize, lint, apiRef, onCursor, onRun, onFormat, onLint }: Props) {
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
    () => ({ lang: new Compartment(), theme: new Compartment(), wrap: new Compartment(), ro: new Compartment(), tab: new Compartment(), lint: new Compartment() }),
    [],
  );
  const cb = useRef({ onCursor, onRun, onFormat, onLint });
  cb.current = { onCursor, onRun, onFormat, onLint };
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const lintRef = useRef(lint);
  lintRef.current = lint;
  const relintRef = useRef<(() => void) | null>(null);
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
          EditorView.contentAttributes.of({ 'aria-label': '코드 편집기' }),
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
            { key: 'Shift-Alt-f', run: () => (cb.current.onFormat(), true) },
            ...yUndoManagerKeymap,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...foldKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          c.lang.of([]),
          c.theme.of(editorTheme(dark)),
          c.wrap.of(wrap ? EditorView.lineWrapping : []),
          c.ro.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          c.tab.of([EditorState.tabSize.of(tabSize), indentUnit.of(' '.repeat(tabSize))]),
          c.lint.of([]),
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
    apiRef.current = {
      goTo(lineNo, col = 1) {
        const doc = view.state.doc;
        const l = doc.line(Math.min(Math.max(1, lineNo), doc.lines));
        const pos = Math.min(l.to, l.from + Math.max(0, col - 1));
        view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
        view.focus();
      },
      replaceAll(text) {
        const cur = view.state.doc.toString();
        if (cur === text) return;
        let start = 0;
        while (start < cur.length && start < text.length && cur[start] === text[start]) start++;
        let endCur = cur.length;
        let endNew = text.length;
        while (endCur > start && endNew > start && cur[endCur - 1] === text[endNew - 1]) endCur--, endNew--;
        view.dispatch({ changes: { from: start, to: endCur, insert: text.slice(start, endNew) }, userEvent: 'input.format' });
      },
      getText: () => view.state.doc.toString(),
      openProblems: () => void openLintPanel(view),
    };
    anchorRef.current = view.contentDOM;
    scrollRef.current = view.scrollDOM;
    setReady(true);

    // 다른 사람이 언어를 바꾸면 문법 강조를 바꾼다
    let lang = file.get('language') as string;
    let cancelled = false;
    const applyLanguage = () => {
      view.dispatch({ effects: c.lint.reconfigure(lintExtension(lang, lintRef.current)) });
      return loadLanguage(lang).then((ext) => {
        if (!cancelled) view.dispatch({ effects: c.lang.reconfigure(ext) });
      });
    };
    // 오류 밑줄: 검사기는 처음 쓸 때 내려받는다 (그동안은 ‘검사 준비 중’)
    let checkedOnce = false;
    // 언어를 바꾸거나 껐을 때 늦게 끝난 이전 검사 결과가 상태 표시줄을 덮지 않게
    let generation = 0;
    const lintExtension = (langId: string, enabled: boolean): Extension => {
      const my = ++generation;
      const report = (s: LintState) => my === generation && cb.current.onLint(s);
      if (!enabled || !canCheck(langId)) {
        cb.current.onLint(null);
        return [];
      }
      return [
        linter(
          async (v): Promise<Diagnostic[]> => {
            if (!checkedOnce) report({ loading: true });
            const group = checkGroup(langId);
            const name = String(file.get('name'));
            const files: Record<string, string> = {};
            for (const f of getFiles(wsRef.current.doc).values()) {
              if (f === file) files[name] = v.state.doc.toString();
              else if (group.has(String(f.get('language')))) files[String(f.get('name'))] = (f.get('content') as Y.Text).toString();
            }
            try {
              const checked = v.state.doc.toString();
              const found = await checkCode(langId, { name, files });
              checkedOnce = true;
              const len = v.state.doc.length;
              const diags: Diagnostic[] = found.map(({ fixes, ...d }) => ({
                ...d,
                from: Math.min(d.from, len),
                to: Math.min(Math.max(d.to, d.from), len),
                // 빠른 수정: 검사한 뒤 내용이 바뀌었으면 위치가 어긋나므로 적용하지 않는다 (곧 다시 검사된다)
                actions: fixes?.map((f) => ({
                  name: f.title,
                  apply: (target: EditorView) => {
                    if (readOnlyRef.current || target.state.doc.toString() !== checked) return;
                    target.dispatch({ changes: f.changes, userEvent: 'input.fix' });
                    wsRef.current.action('🔧 빠른 수정');
                  },
                })),
              }));
              report({ loading: false, errors: diags.filter((d) => d.severity === 'error').length, warnings: diags.filter((d) => d.severity !== 'error').length });
              return diags;
            } catch {
              report({ loading: false, errors: 0, warnings: 0, failed: true });
              return [];
            }
          },
          { delay: 600 },
        ),
        lintGutter(),
      ];
    };
    // 같은 템플릿의 다른 파일이 바뀌면 (import 한 함수 이름이 바뀌는 등) 다시 검사
    const files = getFiles(ws.doc);
    let relint: ReturnType<typeof setTimeout> | undefined;
    const onOtherFile = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      if (!lintRef.current || !canCheck(lang) || events.every((ev) => ev.target === ytext)) return;
      clearTimeout(relint);
      relint = setTimeout(() => forceLinting(view), 800);
    };
    files.observeDeep(onOtherFile);
    relintRef.current = () => view.dispatch({ effects: c.lint.reconfigure(lintExtension(lang, lintRef.current)) });
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
      clearTimeout(relint);
      files.unobserveDeep(onOtherFile);
      file.unobserve(onMeta);
      apiRef.current = null;
      relintRef.current = null;
      setReady(false);
      view.destroy();
      undoManager.destroy();
      viewRef.current = null;
      // 이 파일에서 떠나면 다른 사람 화면의 내 캐럿도 지운다
      awareness.setLocalStateField('cursor', null);
    };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    viewRef.current?.dispatch({ effects: c.theme.reconfigure(editorTheme(dark)) });
  }, [dark, c]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: c.wrap.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap, c]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: c.ro.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly, c]);
  // 오류 밑줄 켜기 · 끄기
  useEffect(() => {
    relintRef.current?.();
  }, [lint]);
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
