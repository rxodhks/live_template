import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Y from 'yjs';
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  FilePlus2,
  MoreHorizontal,
  Play,
  Square,
  Terminal,
  Trash2,
  WrapText,
  X,
} from 'lucide-react';
import { CODE_LANGUAGES, getFiles, getLanguage, renameForLanguage, type CodeLanguage, type YItem } from '@shared/schema';
import { useWorkspace, viewPath } from '../../workspace/context';
import { createCodeFile, deleteItem, renameItem } from '../../workspace/actions';
import { useYField, useYItems } from '../../hooks/useY';
import { useSession } from '../../store/session';
import { toast } from '../../store/toasts';
import { copyText, cx, downloadText } from '../../lib/util';
import { Avatar, Button, EmptyState, IconButton, InlineEdit, Menu, Spinner } from '../../components/ui';
import { useViewers } from '../../components/Cursors';
import { CodeEditor } from './CodeEditor';
import { buildPreview, hasHtml, line, runJavaScript, type OutputLine } from './runner';

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
  const fileId = file.get('id') as string;
  const name = useYField<string>(file, 'name') ?? '';
  const langId = useYField<string>(file, 'language') ?? 'plaintext';
  const lang = getLanguage(langId);
  const viewers = useViewers(ws.view);

  const [wrap, setWrap] = useState(() => localStorage.getItem('lt.code.wrap') === '1');
  const [tabSize, setTabSize] = useState(() => Number(localStorage.getItem('lt.code.tab')) || 2);
  const [pos, setPos] = useState({ line: 1, col: 1, selected: 0 });
  const [panel, setPanel] = useState<null | 'output' | 'preview'>(null);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [running, setRunning] = useState<null | (() => void)>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [panelHeight, setPanelHeight] = useState(240);
  const htmlAvailable = hasHtml(ws.doc);

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
      const d = e.data as { __ltPreview?: boolean; level?: OutputLine['level']; text?: string };
      if (d?.__ltPreview) setOutput((o) => [...o.slice(-300), line(d.level ?? 'log', `[미리보기] ${d.text ?? ''}`)]);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 미리보기가 열려 있으면 파일이 바뀔 때마다 갱신 (다른 사람의 편집도 반영)
  useEffect(() => {
    if (panel !== 'preview') return;
    const files = getFiles(ws.doc);
    let t: ReturnType<typeof setTimeout>;
    const rebuild = () => setPreview(buildPreview(ws.doc, lang.id === 'html' ? fileId : null));
    const schedule = () => {
      clearTimeout(t);
      t = setTimeout(rebuild, 450);
    };
    rebuild();
    files.observeDeep(schedule);
    return () => {
      clearTimeout(t);
      files.unobserveDeep(schedule);
    };
  }, [panel, ws.doc, fileId, lang.id]);

  useEffect(() => () => running?.(), [running]);

  const run = () => {
    ws.report({ type: 'code.run', targetId: fileId, targetName: name });
    ws.action(`▶ ${name} 실행`);
    if (lang.id === 'javascript') {
      running?.();
      setPanel('output');
      setOutput([line('system', `▶ ${name} 실행 (Web Worker · 5초 제한)`)]);
      const code = (file.get('content') as Y.Text).toString();
      const stop = runJavaScript(code, (l) => {
        setOutput((o) => [...o.slice(-500), l]);
        if (l.level === 'system' || /중단|종료/.test(l.text)) setRunning(null);
      });
      setRunning(() => stop);
    } else if (['html', 'css'].includes(lang.id) || htmlAvailable) {
      setPanel('preview');
      setOutput([line('system', '👁 HTML 미리보기를 열었습니다. CSS/JS 파일이 자동으로 연결됩니다.')]);
    } else {
      setPanel('output');
      setOutput([
        line('system', `${lang.name}은(는) 브라우저에서 직접 실행할 수 없습니다.`),
        line('info', '실행은 JavaScript, 미리보기는 HTML(+CSS/JS)을 지원합니다. 코드를 다운로드해 로컬에서 실행해 보세요.'),
      ]);
    }
  };

  const changeLanguage = (next: CodeLanguage) => {
    if (!ws.canEdit || next.id === lang.id) return;
    let newName = renameForLanguage(name, lang, next);
    const taken = Array.from(getFiles(ws.doc).values()).some((f) => f !== file && String(f.get('name')).toLowerCase() === newName.toLowerCase());
    if (taken) newName = name;
    ws.doc.transact(() => {
      file.set('language', next.id);
      if (newName !== name) file.set('name', newName);
    });
    ws.report({ type: 'code.language', targetId: fileId, targetName: newName, detail: next.name });
    ws.action(`언어 변경 → ${next.name}`);
    toast.success(`언어 변경: ${next.name}`, newName !== name ? `파일 이름도 ${name} → ${newName}(으)로 바꿨습니다.` : undefined);
  };

  const content = () => (file.get('content') as Y.Text).toString();

  return (
    <div className="code-module">
      <div className="module-toolbar">
        <span className="lang-dot lg" style={{ background: lang.color }} />
        <InlineEdit className="toolbar-title" value={name} disabled={!ws.canEdit} onCommit={(v) => renameItem(ws, 'code', fileId, v)} />
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
          <Button size="sm" variant="primary" icon={lang.id === 'javascript' ? <Play size={13} /> : <Eye size={13} />} onClick={run} data-tip="Ctrl/⌘ + Enter">
            {lang.id === 'javascript' ? '실행' : htmlAvailable ? '미리보기' : '실행'}
          </Button>
        )}
        {htmlAvailable && lang.id === 'javascript' && (
          <IconButton label="HTML 미리보기" active={panel === 'preview'} onClick={() => setPanel(panel === 'preview' ? null : 'preview')}>
            <Eye size={16} />
          </IconButton>
        )}
        <IconButton label="출력 패널" active={panel === 'output'} onClick={() => setPanel(panel === 'output' ? null : 'output')}>
          <Terminal size={16} />
        </IconButton>
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

      <div className="code-body">
        <CodeEditor
          file={file}
          readOnly={!ws.canEdit}
          wrap={wrap}
          tabSize={tabSize}
          onRun={run}
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
                <Terminal size={13} /> 출력 {output.filter((o) => o.level === 'error').length > 0 && <span className="dot-danger" />}
              </button>
              {htmlAvailable && (
                <button className={cx(panel === 'preview' && 'is-active')} onClick={() => setPanel('preview')}>
                  <Eye size={13} /> 미리보기
                </button>
              )}
              <span className="toolbar-spacer" />
              {panel === 'output' && (
                <button onClick={() => setOutput([])} className="muted">
                  지우기
                </button>
              )}
              <IconButton label="패널 닫기" size="sm" onClick={() => setPanel(null)}>
                <X size={14} />
              </IconButton>
            </div>
            {panel === 'output' ? (
              <div className="code-output" role="log">
                {output.length === 0 && <div className="muted">실행 결과가 여기에 표시됩니다. (Ctrl/⌘ + Enter)</div>}
                {output.map((o) => (
                  <div key={o.id} className={`out-line out-${o.level}`}>
                    {o.text}
                  </div>
                ))}
              </div>
            ) : preview ? (
              <iframe className="code-preview" title="HTML 미리보기" sandbox="allow-scripts allow-modals" srcDoc={preview} />
            ) : (
              <div className="code-output muted">HTML 파일이 없습니다.</div>
            )}
          </div>
        )}
      </div>

      <footer className="statusbar">
        <span>
          줄 {pos.line}, 열 {pos.col}
          {pos.selected > 0 && ` (${pos.selected}자 선택)`}
        </span>
        <span>{lang.name}</span>
        <span>공백 {tabSize}</span>
        <span>UTF-8</span>
        <span className="toolbar-spacer" />
        {!ws.canEdit && <span className="status-readonly">읽기 전용</span>}
        <span>{viewers.length > 0 ? `${viewers.length + 1}명이 이 파일에 있음` : '혼자 편집 중'}</span>
      </footer>
    </div>
  );
}
