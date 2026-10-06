import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Y from 'yjs';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  Eye,
  FilePlus2,
  Keyboard,
  MoreHorizontal,
  Play,
  RefreshCw,
  RotateCw,
  Square,
  Terminal,
  Trash2,
  Users,
  WandSparkles,
  WrapText,
  X,
  XCircle,
} from 'lucide-react';
import { CODE_LANGUAGES, getFiles, getLanguage, renameForLanguage, type CodeLanguage, type YItem } from '@shared/schema';
import { addCodeFile } from '@shared/create';
import { isStarterCode, starterCode } from '@shared/starters';
import { useWorkspace, viewPath } from '../../workspace/context';
import { createCodeFile, deleteItem, renameItem } from '../../workspace/actions';
import { useYField, useYItems } from '../../hooks/useY';
import { useSession } from '../../store/session';
import { toast } from '../../store/toasts';
import { copyText, cx, downloadText, newId } from '../../lib/util';
import { Avatar, Button, EmptyState, IconButton, InlineEdit, Menu, Spinner } from '../../components/ui';
import { useViewers } from '../../components/Cursors';
import { CodeEditor, type EditorApi, type LintState } from './CodeEditor';
import { canCheck, canFormat, formatCode, formatError } from './assist/assist';
import { hasHtml, htmlEntryName, line, withPreviewWatchdog, type OutputLine } from './runner';
import './ide.css';
import { buildHtmlPreview, buildMarkdownPreview, buildReactPreview, checkFile, execInfo, executeFile, unsupportedMessage } from './exec';

export function CodeModule() {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const navigate = useNavigate();
  const files = useYItems(getFiles(ws.doc));
  const itemId = ws.view.itemId;
  const file = itemId ? files.find((f) => f.get('id') === itemId) : undefined;

  // 파일이 지정되지 않았거나 삭제되었으면 첫 파일로 이동
  useEffect(() => {
    if (!file && files.length > 0 && ws.synced) navigate(viewPath(ws.template.id, 'code', files[0].get('id') as string), { replace: true });
  }, [file, files.length, ws.synced]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!file) {
    if (!ws.synced && files.length === 0)
      return (
        <div className="center-fill">
          <Spinner size={24} />
        </div>
      );
    return (
      <EmptyState
        icon={<Terminal size={34} />}
        title={files.length ? '파일을 여는 중…' : '아직 코드 파일이 없습니다'}
        action={
          ws.canEdit && !files.length ? (
            <Button variant="primary" icon={<FilePlus2 size={15} />} onClick={() => void createCodeFile(ws, me)}>
              새 파일 만들기
            </Button>
          ) : undefined
        }
      >
        파일 이름의 확장자로 언어가 자동 선택되며, 편집기 상단에서 언어를 바꿀 수 있습니다.
      </EmptyState>
    );
  }
  return <CodeWorkspace key={file.get('id') as string} file={file} />;
}

function CodeWorkspace({ file }: { file: YItem }) {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const fileId = file.get('id') as string;
  const name = useYField<string>(file, 'name') ?? '';
  const langId = useYField<string>(file, 'language') ?? 'plaintext';
  const lang = getLanguage(langId);
  const viewers = useViewers(ws.view);
  const navigate = useNavigate();

  const [wrap, setWrap] = useState(() => localStorage.getItem('lt.code.wrap') === '1');
  const [tabSize, setTabSize] = useState(() => Number(localStorage.getItem('lt.code.tab')) || 2);
  // 오류 밑줄 (JS · TS · 파이썬) — 기본으로 켜 두고, 끄면 이 기기에 기억한다
  const [lintOn, setLintOn] = useState(() => readLocal('lt.code.lint') !== '0');
  const [lintState, setLintState] = useState<LintState | null>(null);
  const [formatting, setFormatting] = useState(false);
  const editorApi = useRef<EditorApi | null>(null);
  const [pos, setPos] = useState({ line: 1, col: 1, selected: 0 });
  // 아래 패널: 실행 결과(출력) · 표준 입력. 미리보기는 편집기 오른쪽에 따로 띄운다
  const [panel, setPanel] = useState<null | 'output' | 'input'>(null);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [running, setRunning] = useState<null | (() => void)>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [formatted, setFormatted] = useState<{ title: string; text: string } | null>(null);
  // 미리보기 문서 — 바뀔 때마다 새 화면(iframe)으로 띄운다 (멈춘 화면은 새 문서를 불러오지 못한다)
  const [preview, setPreview] = useState<{ html: string; v: number } | null>(null);
  const previewSeq = useRef(0);
  const [previewHung, setPreviewHung] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [panelHeight, setPanelHeight] = useState(240);
  // 오른쪽 미리보기 — 열림 여부는 템플릿마다, 너비(비율)는 이 기기에 기억한다.
  // HTML · CSS · JS 같은 웹 파일끼리는 옮겨 다녀도 그대로 열려 있어 고치면서 바로 볼 수 있고, 파이썬 · SQL 등에서는 직접 열 때만 보인다
  const previewOpenKey = `lt.code.preview.${ws.template.id}`;
  const webFile = WEB_LANGS.has(lang.id);
  const [previewOpen, setPreviewOpenState] = useState(() => webFile && readLocal(previewOpenKey) === '1');
  const setPreviewOpen = (open: boolean) => {
    setPreviewOpenState(open);
    if (webFile) writeLocal(previewOpenKey, open ? '1' : null);
  };
  const [sideRatio, setSideRatio] = useState(() => {
    const v = Number(readLocal('lt.code.previewWidth'));
    return v >= SIDE_MIN_RATIO && v <= SIDE_MAX_RATIO ? v : SIDE_DEFAULT_RATIO;
  });
  const [resizing, setResizing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const htmlAvailable = hasHtml(ws.doc);
  const info = execInfo(lang.id);
  // 미리보기 종류: JSX/TSX는 React 컴포넌트, Markdown은 문서, 그 밖에는 HTML 파일이 있을 때 HTML 미리보기
  const previewKind: 'html' | 'react' | 'markdown' | null =
    lang.id === 'jsx' || lang.id === 'tsx' ? 'react' : lang.id === 'markdown' ? 'markdown' : htmlAvailable ? 'html' : null;

  // 표준 입력(input(), gets …)으로 넣을 값 — 파일마다 이 기기에만 저장
  const stdinKey = `lt.stdin.${ws.template.id}.${fileId}`;
  const [stdin, setStdin] = useState(() => {
    try {
      return localStorage.getItem(stdinKey) ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    try {
      if (stdin) localStorage.setItem(stdinKey, stdin);
      else localStorage.removeItem(stdinKey);
    } catch {
      /* 무시 */
    }
  }, [stdin, stdinKey]);
  const stdinLines = stdin.replace(/\n$/, '') ? stdin.replace(/\n$/, '').split('\n').length : 0;
  const showPreview = previewOpen && previewKind !== null;

  useEffect(() => {
    if (!resizing) writeLocal('lt.code.previewWidth', sideRatio.toFixed(3));
  }, [sideRatio, resizing]);

  useEffect(() => {
    try {
      localStorage.setItem('lt.code.wrap', wrap ? '1' : '0');
      localStorage.setItem('lt.code.tab', String(tabSize));
    } catch {
      /* 무시 */
    }
  }, [wrap, tabSize]);

  // 미리보기 콘솔 메시지 수집
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      // 이 미리보기 창이 보낸 것만 (문서의 임베드 같은 다른 창이 가짜 콘솔 줄을 넣지 못하게)
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as { __ltPreview?: boolean; level?: OutputLine['level']; text?: string };
      if (d?.__ltPreview) setOutput((o) => [...o.slice(-300), { ...line(d.level ?? 'log', `[미리보기] ${d.text ?? ''}`), fromPreview: true }]);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 미리보기가 열려 있으면 파일이 바뀔 때마다 갱신 (다른 사람의 편집도 반영)
  useEffect(() => {
    if (!showPreview || !previewKind) return;
    const files = getFiles(ws.doc);
    let t: ReturnType<typeof setTimeout>;
    let alive = true;
    let seq = 0;
    const rebuild = async () => {
      const my = ++seq;
      try {
        const html =
          previewKind === 'react'
            ? await buildReactPreview(ws.doc, String(file.get('name')))
            : previewKind === 'markdown'
              ? await buildMarkdownPreview((file.get('content') as Y.Text).toString())
              : await buildHtmlPreview(ws.doc, lang.id === 'html' ? fileId : null);
        if (alive && my === seq) setPreview(html === null ? null : { html: withPreviewWatchdog(html), v: ++previewSeq.current });
      } catch (err) {
        if (alive) setOutput((o) => [...o.slice(-300), line('error', `미리보기를 만들지 못했습니다: ${err instanceof Error ? err.message : String(err)}`)]);
      }
    };
    const schedule = () => {
      clearTimeout(t);
      t = setTimeout(() => void rebuild(), 450);
    };
    void rebuild();
    files.observeDeep(schedule);
    return () => {
      alive = false;
      clearTimeout(t);
      files.unobserveDeep(schedule);
    };
  }, [showPreview, ws.doc, fileId, lang.id, previewKind, file]);

  // 미리보기 멈춤 감지: 신호가 4초 넘게 없으면 (무한 반복 등) 미리보기를 없애고 알린다
  const previewVersion = showPreview ? preview?.v : undefined;
  useEffect(() => {
    if (previewVersion === undefined) return;
    setPreviewHung(false);
    let last = performance.now();
    let modal = false;
    const onBeat = (e: MessageEvent) => {
      const beat = (e.data as { __ltBeat?: 1 | 'modal' })?.__ltBeat;
      if (!beat || e.source !== frameRef.current?.contentWindow) return;
      last = performance.now();
      modal = beat === 'modal';
    };
    // 탭이 가려져 있으면 타이머가 느려지므로 다시 보일 때부터 센다
    const onVisible = () => {
      last = performance.now();
    };
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible' || modal || performance.now() - last < PREVIEW_HANG_MS) return;
      clearInterval(timer);
      setPreviewHung(true);
      setOutput((o) => [
        ...o.slice(-300),
        { ...line('warn', `[미리보기] ${PREVIEW_HANG_MS / 1000}초 넘게 응답이 없어 미리보기를 멈췄습니다. 끝나지 않는 반복(while (true) 등)이 있는지 확인해 보세요.`), fromPreview: true },
      ]);
    }, 500);
    window.addEventListener('message', onBeat);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('message', onBeat);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [previewVersion]);

  /** 미리보기를 처음부터 다시 불러온다 (스크립트 · 애니메이션 다시 시작) */
  const reloadPreview = () => setPreview((p) => p && { ...p, v: ++previewSeq.current });

  useEffect(() => () => running?.(), [running]);

  // 출력의 오류 줄을 눌러 다른 파일로 왔으면 그 줄로 이동
  useEffect(() => {
    const g = pendingGoto;
    if (g && g.fileId === fileId) {
      pendingGoto = null;
      editorApi.current?.goTo(g.line, g.col);
    }
  }, [fileId]);

  /** 출력에 나온 ‘파일:줄’로 이동 */
  const goToLocation = (fileName: string, lineNo: number, col?: number) => {
    if (fileName === name) return editorApi.current?.goTo(lineNo, col);
    const target = Array.from(getFiles(ws.doc).values()).find((f) => String(f.get('name')) === fileName);
    if (!target) return;
    pendingGoto = { fileId: String(target.get('id')), line: lineNo, col };
    navigate(viewPath(ws.template.id, 'code', String(target.get('id'))));
  };
  const fileNames = Array.from(getFiles(ws.doc).values()).map((f) => String(f.get('name')));

  /** 자동 정렬 (Shift+Alt+F) */
  const formatNow = async () => {
    const api = editorApi.current;
    if (!api || !ws.canEdit || !canFormat(lang.id) || formatting) return;
    const before = api.getText();
    setFormatting(true);
    try {
      const out = await formatCode(lang.id, name, before, lang.id === 'python' ? 4 : tabSize);
      if (api.getText() !== before) toast.error('정렬하는 동안 내용이 바뀌어 적용하지 않았습니다', '다시 한 번 눌러 주세요.');
      else if (out === before) toast.success('이미 정렬되어 있습니다');
      else {
        api.replaceAll(out);
        ws.action('✨ 코드 정렬');
        toast.success('코드를 정렬했습니다', '되돌리려면 Ctrl/⌘ + Z');
      }
    } catch (err) {
      toast.error('정렬하지 못했습니다', `문법 오류를 먼저 고쳐 주세요. ${formatError(err)}`);
    } finally {
      setFormatting(false);
    }
  };

  const run = async () => {
    ws.report({ type: 'code.run', targetId: fileId, targetName: name });
    ws.action(`▶ ${name} ${info.label}`);
    setFormatted(null);
    if (info.mode === 'preview') {
      if (!previewKind) {
        setPanel('output');
        setOutput([line('system', 'HTML 파일이 없어 미리보기를 만들 수 없습니다. index.html 파일을 만들고 이 파일을 연결해 보세요.')]);
        return;
      }
      // 이미 열려 있으면 처음부터 다시 불러온다 (스크립트 · 애니메이션 다시 시작)
      if (showPreview) reloadPreview();
      else setPreviewOpen(true);
      return;
    }
    if (info.mode === 'check' || info.mode === 'convert') {
      setPanel('output');
      setOutput([line('system', `▶ ${name} ${info.label}`)]);
      const r = await checkFile(lang.id, name, (file.get('content') as Y.Text).toString());
      setOutput((o) => [...o, ...r.lines]);
      setFormatted(r.formatted ?? null);
      return;
    }
    if (info.mode === 'none') {
      setPanel('output');
      setOutput(unsupportedMessage(lang.name, lang.id));
      return;
    }
    running?.();
    setPanel('output');
    const note = info.stdin && stdinLines ? ` · 입력 ${stdinLines}줄` : '';
    setOutput([line('system', `▶ ${name} 실행 (${lang.name} · 격리된 샌드박스 · ${Math.round((info.timeoutMs ?? 10000) / 1000)}초 제한${note})`)]);
    const add = (l: OutputLine) => setOutput((o) => [...o.slice(-800), l]);
    let stopFn: (() => void) | null = null;
    let cancelled = false;
    setRunning(() => () => {
      cancelled = true;
      stopFn?.();
      setRunning(null);
      setStatus(null);
    });
    const stop = await executeFile(ws.doc, file, info.stdin ? stdin : '', {
      onLine: add,
      onTable: (t) => add({ ...line('log', t.note ?? ''), table: t }),
      onStatus: setStatus,
      onEnd: () => {
        setRunning(null);
        setStatus(null);
      },
    });
    if (cancelled) stop();
    else stopFn = stop;
  };

  /** JSON 정리 결과를 파일에 적용 */
  const applyFormatted = () => {
    if (!formatted || !ws.canEdit) return;
    const t = file.get('content') as Y.Text;
    ws.doc.transact(() => {
      t.delete(0, t.length);
      t.insert(0, formatted.text + '\n');
    });
    toast.success('정리된 내용을 파일에 적용했습니다');
  };

  /** 변환된 CSS를 같은 이름의 .css 파일로 저장 */
  const saveCss = () => {
    if (!formatted || !ws.canEdit) return;
    const cssName = name.replace(/\.(scss|sass)$/i, '') + '.css';
    const existing = Array.from(getFiles(ws.doc).values()).find((f) => String(f.get('name')).toLowerCase() === cssName.toLowerCase());
    if (existing) {
      const t = existing.get('content') as Y.Text;
      ws.doc.transact(() => {
        t.delete(0, t.length);
        t.insert(0, formatted.text);
      });
    } else {
      const id = newId();
      addCodeFile(ws.doc, { id, name: cssName, language: 'css', content: formatted.text, createdBy: me.id });
      ws.report({ type: 'code.create', targetId: id, targetName: cssName });
    }
    toast.success(`${cssName} 파일에 저장했습니다`);
  };

  const changeLanguage = (next: CodeLanguage) => {
    if (!ws.canEdit || next.id === lang.id) return;
    let newName = renameForLanguage(name, lang, next);
    const taken = Array.from(getFiles(ws.doc).values()).some((f) => f !== file && String(f.get('name')).toLowerCase() === newName.toLowerCase());
    if (taken) newName = name;
    // 아직 시작 코드 그대로면 새 언어의 시작 코드로 바꾼다 (사용자가 고친 내용은 그대로 둔다)
    const text = file.get('content') as Y.Text;
    const swapStarter = isStarterCode(text.toString());
    ws.doc.transact(() => {
      file.set('language', next.id);
      if (newName !== name) file.set('name', newName);
      if (swapStarter) {
        text.delete(0, text.length);
        text.insert(0, starterCode(next.id));
      }
    });
    ws.report({ type: 'code.language', targetId: fileId, targetName: newName, detail: next.name });
    ws.action(`언어 변경 → ${next.name}`);
    const notes = [newName !== name ? `파일 이름도 ${name} → ${newName}(으)로 바꿨습니다.` : '', swapStarter ? `시작 코드도 ${next.name}에 맞게 바꿨습니다.` : ''].filter(Boolean);
    toast.success(`언어 변경: ${next.name}`, notes.length ? notes.join(' ') : undefined);
  };

  const content = () => (file.get('content') as Y.Text).toString();

  // 출력 패널: 새 출력이 오면 맨 아래로 따라 내려간다 (사용자가 위로 올려 보는 중이면 그대로 둔다)
  const outRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const firstOutId = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = outRef.current;
    // 새로 실행해 출력이 처음부터 다시 쌓이면 다시 맨 아래 따라가기
    if (output[0]?.id !== firstOutId.current) stickRef.current = true;
    firstOutId.current = output[0]?.id;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [output, status, panel]);
  const onOutputScroll = () => {
    const el = outRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const errorCount = output.filter((o) => o.level === 'error').length;
  const previewLogs = output.filter((o) => o.fromPreview).length;
  const previewErrors = output.filter((o) => o.fromPreview && o.level === 'error').length;
  const previewTitle = previewKind === 'react' ? 'React 미리보기' : previewKind === 'markdown' ? 'Markdown 미리보기' : 'HTML 미리보기';
  // CSS · JS 파일을 보고 있을 때는 어떤 HTML 파일을 보여 주는지 함께 적는다
  const previewHtmlName = previewKind === 'html' && lang.id !== 'html' ? htmlEntryName(ws.doc) : null;

  /** 미리보기 왼쪽 경계를 끌어 너비 조절 (iframe 위로 지나가도 끊기지 않게 포인터를 붙잡는다) */
  const startSideResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const body = bodyRef.current;
    if (!body || e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setResizing(true);
    const rect = body.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const ratio = (rect.right - ev.clientX) / rect.width;
      setSideRatio(Math.min(Math.max(ratio, SIDE_MIN_RATIO), SIDE_MAX_RATIO));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setResizing(false);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  return (
    <div className="code-module">
      <div className="module-toolbar code-toolbar">
        {/* IDE 의 열린 파일 탭처럼 */}
        <div className="code-tab">
          <span className="lang-dot" style={{ background: lang.color }} />
          <InlineEdit className="toolbar-title" value={name} disabled={!ws.canEdit} onCommit={(v) => renameItem(ws, 'code', fileId, v)} />
        </div>
        <Menu
          width={230}
          header="언어 선택"
          items={() =>
            CODE_LANGUAGES.map((l) => ({
              label: l.name,
              icon: <span className="lang-dot" style={{ background: l.color }} />,
              hint: l.id === lang.id ? <Check size={14} /> : `.${l.ext}`,
              disabled: !ws.canEdit,
              onSelect: () => changeLanguage(l),
            }))
          }
          trigger={({ toggle, ref, open }) => (
            <button ref={ref} className="lang-select" onClick={toggle} aria-expanded={open} data-tip={ws.canEdit ? '언어 변경 (모든 사람에게 적용)' : '읽기 전용'}>
              {lang.name}
              <ChevronDown size={14} />
            </button>
          )}
        />
        {viewers.length > 0 && (
          <span className="toolbar-viewers">
            {viewers.map((v) => (
              <Avatar key={v.socketId} user={v.user} size={22} status={v.idle ? 'idle' : 'online'} tooltip={`${v.user.name} 님이 이 파일을 보는 중`} />
            ))}
          </span>
        )}
        <span className="toolbar-spacer" />
        {running ? (
          <Button size="sm" variant="danger" icon={<Square size={13} />} onClick={() => running()}>
            중지
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            icon={
              info.mode === 'preview' ? <Eye size={13} /> : info.mode === 'check' ? <CheckCircle2 size={13} /> : info.mode === 'convert' ? <RefreshCw size={13} /> : <Play size={13} />
            }
            onClick={() => void run()}
            data-tip="Ctrl/⌘ + Enter"
          >
            {info.label}
          </Button>
        )}
        {previewKind === 'html' && info.mode !== 'preview' && (
          <IconButton label={showPreview ? 'HTML 미리보기 닫기' : 'HTML 미리보기 (오른쪽)'} active={showPreview} onClick={() => setPreviewOpen(!showPreview)}>
            <Eye size={16} />
          </IconButton>
        )}
        {info.stdin && (
          <IconButton label={`입력값 (표준 입력)${stdinLines ? ` · ${stdinLines}줄` : ''}`} active={panel === 'input'} onClick={() => setPanel(panel === 'input' ? null : 'input')}>
            <Keyboard size={16} />
          </IconButton>
        )}
        <IconButton label="출력 패널" active={panel === 'output'} onClick={() => setPanel(panel === 'output' ? null : 'output')}>
          <Terminal size={16} />
        </IconButton>
        {canFormat(lang.id) && ws.canEdit && (
          <IconButton label="자동 정렬 (Shift + Alt + F)" onClick={() => void formatNow()} disabled={formatting}>
            {formatting ? <Spinner size={14} /> : <WandSparkles size={16} />}
          </IconButton>
        )}
        <IconButton label={wrap ? '자동 줄바꿈 끄기' : '자동 줄바꿈 켜기'} active={wrap} onClick={() => setWrap((w) => !w)}>
          <WrapText size={16} />
        </IconButton>
        <Menu
          align="end"
          items={[
            { label: '파일 다운로드', icon: <Download size={14} />, onSelect: () => downloadText(name, content()) },
            { label: '전체 복사', icon: <Copy size={14} />, onSelect: async () => (await copyText(content())) && toast.success('코드를 복사했습니다') },
            { divider: true, label: '' },
            ...[2, 4].map((n) => ({ label: `들여쓰기 ${n}칸`, checked: tabSize === n, hint: tabSize === n ? <Check size={14} /> : undefined, onSelect: () => setTabSize(n) })),
            ...(canCheck(lang.id)
              ? [
                  {
                    label: '오류 밑줄 표시',
                    checked: lintOn,
                    hint: lintOn ? <Check size={14} /> : undefined,
                    onSelect: () => {
                      setLintOn(!lintOn);
                      writeLocal('lt.code.lint', lintOn ? '0' : null);
                    },
                  },
                ]
              : []),
            { divider: true, label: '' },
            { label: '파일 삭제', icon: <Trash2 size={14} />, danger: true, disabled: !ws.canEdit, onSelect: () => void deleteItem(ws, 'code', fileId) },
          ]}
          trigger={({ toggle, ref }) => (
            <IconButton ref={ref} label="더 보기" onClick={toggle}>
              <MoreHorizontal size={16} />
            </IconButton>
          )}
        />
      </div>

      <div
        ref={bodyRef}
        className={cx('code-body', showPreview && 'has-side', resizing && 'is-resizing')}
        style={{ '--side-w': `${(sideRatio * 100).toFixed(2)}%` } as CSSProperties}
      >
        <div className="code-main">
          <CodeEditor
            file={file}
            readOnly={!ws.canEdit}
            wrap={wrap}
            tabSize={tabSize}
            lint={lintOn}
            apiRef={editorApi}
            onRun={run}
            onFormat={() => void formatNow()}
            onLint={setLintState}
            onCursor={(l, c, selected) => setPos({ line: l, col: c, selected })}
          />
          {panel && (
            <div className="code-panel" style={{ height: panelHeight }}>
              <div
                className="code-panel-resize"
                onPointerDown={(e) => {
                  const startY = e.clientY;
                  const startH = panelHeight;
                  const move = (ev: PointerEvent) => setPanelHeight(Math.min(Math.max(startH - (ev.clientY - startY), 120), window.innerHeight * 0.7));
                  const up = () => {
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', up);
                  };
                  window.addEventListener('pointermove', move);
                  window.addEventListener('pointerup', up);
                }}
              />
              <div className="code-panel-tabs">
                <button className={cx(panel === 'output' && 'is-active')} onClick={() => setPanel('output')}>
                  <Terminal size={13} /> 출력 {errorCount > 0 && <span className="dot-danger" />}
                </button>
                {info.stdin && (
                  <button className={cx(panel === 'input' && 'is-active')} onClick={() => setPanel('input')}>
                    <Keyboard size={13} /> 입력{stdinLines > 0 && <span className="tab-count">{stdinLines}</span>}
                  </button>
                )}
                <span className="toolbar-spacer" />
                {panel === 'output' && (
                  <button
                    onClick={() => {
                      setOutput([]);
                      setFormatted(null);
                    }}
                    className="muted"
                  >
                    지우기
                  </button>
                )}
                {panel === 'input' && stdin && (
                  <button onClick={() => setStdin('')} className="muted">
                    비우기
                  </button>
                )}
                <IconButton label="패널 닫기" size="sm" onClick={() => setPanel(null)}>
                  <X size={14} />
                </IconButton>
              </div>
              {panel === 'output' ? (
                <div className="code-output" role="log" ref={outRef} onScroll={onOutputScroll}>
                  {status && (
                    <div className="out-status">
                      <Spinner size={12} /> {status}
                    </div>
                  )}
                  {output.length === 0 && !status && (
                    <div className="muted">{info.mode === 'preview' ? '미리보기의 console.log · 오류가 여기에 표시됩니다.' : '실행 결과가 여기에 표시됩니다. (Ctrl/⌘ + Enter)'}</div>
                  )}
                  {output.map((o) =>
                    o.table ? (
                      <OutputTable key={o.id} note={o.text} table={o.table} />
                    ) : (
                      <div key={o.id} className={`out-line out-${o.level}`}>
                        {o.fromPreview ? o.text : linkLocations(o.text, fileNames, name, goToLocation)}
                      </div>
                    ),
                  )}
                  {formatted && (
                    <div className="out-formatted">
                      <div className="out-formatted-head">
                        <b>{formatted.title}</b>
                        <span className="toolbar-spacer" />
                        <button className="link small" onClick={async () => (await copyText(formatted.text)) && toast.success('복사했습니다')}>
                          복사
                        </button>
                        {lang.id === 'json' && ws.canEdit && (
                          <button className="link small" onClick={applyFormatted}>
                            파일에 적용
                          </button>
                        )}
                        {lang.id === 'scss' && ws.canEdit && (
                          <button className="link small" onClick={saveCss}>
                            CSS 파일로 저장
                          </button>
                        )}
                      </div>
                      <pre>{formatted.text}</pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="code-stdin">
                  <textarea
                    value={stdin}
                    onChange={(e) => setStdin(e.target.value)}
                    spellCheck={false}
                    aria-label="표준 입력"
                    placeholder={'실행할 때 프로그램에 넣을 입력값을 한 줄에 하나씩 적으세요.\n예) 파이썬 input(), Ruby gets, Lua io.read(), PHP fgets(STDIN)'}
                  />
                  <p className="muted small">이 파일을 실행할 때마다 위 내용이 표준 입력으로 들어갑니다. 입력값은 이 기기에만 저장됩니다.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {showPreview && (
          <aside className="code-side" aria-label={previewTitle}>
            <div
              className="code-side-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label="미리보기 너비 조절"
              data-tip="끌어서 너비 조절 · 두 번 눌러 반반"
              onPointerDown={startSideResize}
              onDoubleClick={() => setSideRatio(SIDE_DEFAULT_RATIO)}
            />
            <div className="code-side-head">
              <Eye size={14} />
              <b>{previewTitle}</b>
              {previewKind === 'html' && lang.id !== 'html' && previewHtmlName && <span className="muted small">{previewHtmlName}</span>}
              <span className="toolbar-spacer" />
              {previewLogs > 0 && (
                <button className={cx('side-console', previewErrors > 0 && 'has-error')} onClick={() => setPanel('output')} data-tip="미리보기의 console 출력을 아래 출력 패널에서 봅니다">
                  <Terminal size={13} /> 콘솔 {previewLogs}
                </button>
              )}
              <IconButton label="새로 고침" size="sm" onClick={reloadPreview}>
                <RotateCw size={14} />
              </IconButton>
              <IconButton label="미리보기 닫기" size="sm" onClick={() => setPreviewOpen(false)}>
                <X size={14} />
              </IconButton>
            </div>
            {preview && previewHung ? (
              <div className="code-side-empty is-hung" role="alert">
                <AlertTriangle size={22} />
                <b>미리보기가 응답하지 않아 멈췄습니다</b>
                <span className="muted small">끝나지 않는 반복(while (true) 등)이 있는지 확인해 보세요. 코드를 고치면 자동으로 다시 불러옵니다.</span>
                <Button size="sm" icon={<RotateCw size={13} />} onClick={reloadPreview}>
                  다시 불러오기
                </Button>
              </div>
            ) : preview ? (
              <iframe
                key={preview.v}
                ref={frameRef}
                className={cx('code-preview', previewKind === 'markdown' && 'is-doc')}
                title={previewTitle}
                sandbox="allow-scripts allow-modals"
                srcDoc={preview.html}
              />
            ) : (
              <div className="code-side-empty muted">
                <Spinner size={16} /> 미리보기를 만드는 중…
              </div>
            )}
          </aside>
        )}
      </div>

      <footer className="statusbar">
        <span className={cx('status-collab', viewers.length > 0 && 'is-live')}>
          <Users size={12} />
          {viewers.length > 0 ? `${viewers.length + 1}명이 이 파일에 있음` : '혼자 편집 중'}
        </span>
        {lintState && (
          <button
            className={cx('status-item status-lint', !lintState.loading && lintState.errors > 0 && 'has-error', !lintState.loading && lintState.warnings > 0 && 'has-warning')}
            onClick={() => editorApi.current?.openProblems()}
            data-tip="문제 목록 열기 (오류 밑줄에 마우스를 올리면 설명이 보입니다)"
          >
            {lintState.loading ? (
              '코드 검사 준비 중…'
            ) : lintState.failed ? (
              '코드 검사 도구를 불러오지 못했습니다'
            ) : lintState.errors + lintState.warnings === 0 ? (
              <>
                <CheckCircle2 size={12} />
                문제 없음
              </>
            ) : (
              <>
                {lintState.errors > 0 && (
                  <span className="lint-count is-error">
                    <XCircle size={12} />
                    오류 {lintState.errors}
                  </span>
                )}
                {lintState.warnings > 0 && (
                  <span className="lint-count is-warning">
                    <AlertTriangle size={12} />
                    경고 {lintState.warnings}
                  </span>
                )}
              </>
            )}
          </button>
        )}
        <span className="toolbar-spacer" />
        {!ws.canEdit && <span className="status-readonly">읽기 전용</span>}
        <span className="status-item">
          줄 {pos.line}, 열 {pos.col}
          {pos.selected > 0 && ` (${pos.selected}자 선택)`}
        </span>
        <span className="status-item">공백 {tabSize}</span>
        <span className="status-item">UTF-8</span>
        <span className="status-item">
          <span className="lang-dot" style={{ background: lang.color }} />
          {lang.name}
        </span>
      </footer>
    </div>
  );
}

/** SQL 결과 표 */
function OutputTable({ note, table }: { note: string; table: NonNullable<OutputLine['table']> }) {
  const cell = (v: unknown) =>
    v === null || v === undefined ? <span className="is-null">NULL</span> : v instanceof Uint8Array ? `<BLOB ${v.length}B>` : String(v);
  return (
    <div className="out-table-wrap">
      {note && <div className="out-table-note">{note}</div>}
      <div className="out-table-scroll">
        <table className="out-table">
          <thead>
            <tr>
              {table.columns.map((c, i) => (
                <th key={i}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j}>{cell(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted small">
        {table.total === 0 ? '결과 없음 (0행)' : table.total > table.rows.length ? `처음 ${table.rows.length}행만 표시 (전체 ${table.total}행)` : `${table.total}행`}
      </div>
    </div>
  );
}

const PREVIEW_HANG_MS = 4000;
/** 미리보기를 연 채로 옮겨 다니는 파일 (미리보기 화면에 바로 반영되는 것들) */
const WEB_LANGS = new Set(['html', 'css', 'scss', 'javascript', 'typescript', 'jsx', 'tsx', 'markdown']);
const SIDE_MIN_RATIO = 0.2;
const SIDE_MAX_RATIO = 0.8;
const SIDE_DEFAULT_RATIO = 0.5;

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 무시 */
  }
}

/** 다른 파일로 이동할 때 열고 나서 갈 줄 */
let pendingGoto: { fileId: string; line: number; col?: number } | null = null;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 출력에 나온 ‘파일 이름 + 줄 번호’를 누르면 그 줄로 가는 링크로 바꾼다
 *  - JS · Lua · Ruby: main.js:3 · Python: File "main.py", line 3 · PHP: main.php on line 3 · JSON/YAML 검사: 3번째 줄, 5번째 글자
 */
export function linkLocations(text: string, fileNames: string[], current: string, go: (file: string, line: number, col?: number) => void): ReactNode {
  const names = [...fileNames].sort((a, b) => b.length - a.length).map(escapeRe);
  const alt = names.length ? names.join('|') : '(?!)';
  const re = new RegExp(`File "(${alt})", line (\\d+)|(${alt}):(\\d+)(?::(\\d+))?|(${alt}) on line (\\d+)|(\\d+)번째 줄(?:, (\\d+)번째 글자)?`, 'g');
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const file = m[1] ?? m[3] ?? m[6] ?? current;
    const lineNo = Number(m[2] ?? m[4] ?? m[7] ?? m[8]);
    const col = m[5] ?? m[9] ? Number(m[5] ?? m[9]) : undefined;
    if (!lineNo) continue;
    parts.push(text.slice(last, m.index));
    parts.push(
      <button key={m.index} type="button" className="out-loc" onClick={() => go(file, lineNo, col)} data-tip={`${file} ${lineNo}번째 줄로 이동`}>
        {m[0]}
      </button>,
    );
    last = m.index + m[0].length;
  }
  if (!parts.length) return text;
  parts.push(text.slice(last));
  return parts;
}
