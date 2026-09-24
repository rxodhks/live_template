import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import type { Feature, TemplateSummary } from '@shared/types';
import { FEATURE_INFO, FEATURE_ORDER } from '@shared/presets';
import { addBoard, addCodeFile, addDocument, getBoards, getDocs, getFiles } from '@shared/schema';
import { BLANK_CONTENT } from '@shared/presets';
import { useWorkspace } from './context';
import { useTemplates } from '../store/templates';
import { useSession } from '../store/session';
import { toast } from '../store/toasts';
import { api, errorMessage } from '../lib/api';
import { cx, newId } from '../lib/util';
import { CursorPage } from '../components/Cursors';
import { Button, Field, confirmDialog } from '../components/ui';

const EMOJIS = ['🗂️', '🚀', '🎨', '💻', '📝', '🧭', '🌐', '🧪', '📊', '🎯', '🛠️', '💡', '📚', '🎮', '🏝️', '🔥'];

/** 템플릿 설정 — 입력하면 잠시 후 자동 저장 */
export function Settings() {
  const ws = useWorkspace();
  const t = ws.template;
  const me = useSession((s) => s.user)!;
  const navigate = useNavigate();
  const [name, setName] = useState(t.name);
  const [description, setDescription] = useState(t.description);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 다른 사람이 바꾸면 반영 (내가 입력 중이 아닐 때)
  useEffect(() => {
    if (!timer.current) {
      setName(t.name);
      setDescription(t.description);
    }
  }, [t.name, t.description]);

  const save = async (patch: Partial<{ name: string; description: string; emoji: string; features: Feature[] }>) => {
    setState('saving');
    try {
      const res = await api<{ template: TemplateSummary }>('PATCH', `/templates/${t.id}`, patch);
      useTemplates.getState().upsert(res.template);
      setState('saved');
      return true;
    } catch (err) {
      toast.error('설정을 저장하지 못했습니다', errorMessage(err));
      setState('idle');
      return false;
    }
  };

  const debounced = (patch: Partial<{ name: string; description: string }>) => {
    clearTimeout(timer.current);
    setState('saving');
    timer.current = setTimeout(() => {
      timer.current = undefined;
      if (patch.name !== undefined && !patch.name.trim()) {
        setState('idle');
        return;
      }
      void save(patch);
    }, 700);
  };

  const toggleFeature = async (f: Feature) => {
    const on = t.features.includes(f);
    if (on && t.features.length === 1) {
      toast.warning('기능은 하나 이상 필요합니다');
      return;
    }
    if (on) {
      const ok = await confirmDialog({
        title: `${FEATURE_INFO[f].name} 기능을 끌까요?`,
        message: '내용은 삭제되지 않고 숨겨지기만 합니다. 다시 켜면 그대로 돌아옵니다.',
        confirmText: '끄기',
      });
      if (!ok) return;
    }
    const features = on ? t.features.filter((x) => x !== f) : FEATURE_ORDER.filter((x) => x === f || t.features.includes(x));
    if (await save({ features })) {
      // 처음 켠 기능이 비어 있으면 기본 항목을 하나 만들어 준다
      if (!on && ws.canEdit) {
        const doc = ws.doc;
        if (f === 'code' && getFiles(doc).size === 0) {
          const c = BLANK_CONTENT.code[0];
          addCodeFile(doc, { id: newId(), name: c.name, content: c.content, createdBy: me.id });
        }
        if (f === 'docs' && getDocs(doc).size === 0) {
          const d = BLANK_CONTENT.docs[0];
          addDocument(doc, { id: newId(), title: d.title, emoji: d.emoji, blocks: d.blocks, createdBy: me.id });
        }
        if (f === 'design' && getBoards(doc).size === 0) addBoard(doc, { id: newId(), name: '보드 1', createdBy: me.id });
      }
      toast.success(on ? `${FEATURE_INFO[f].name} 기능을 껐습니다` : `${FEATURE_INFO[f].name} 기능을 켰습니다`);
    }
  };

  const removeTemplate = async () => {
    const ok = await confirmDialog({
      title: '템플릿을 영구 삭제할까요?',
      message: '모든 멤버에게서 디자인·코드·문서·비밀 노트·채팅·타임라인이 삭제되며 되돌릴 수 없습니다.',
      confirmText: '영구 삭제',
      danger: true,
      requireText: t.name,
    });
    if (!ok) return;
    try {
      await api('DELETE', `/templates/${t.id}`);
      useTemplates.getState().remove(t.id);
      toast.show({ kind: 'danger', title: '템플릿을 삭제했습니다', message: t.name });
      navigate('/');
    } catch (err) {
      toast.error('삭제하지 못했습니다', errorMessage(err));
    }
  };

  const readOnly = !ws.canEdit;

  return (
    <CursorPage>
      <header className="page-header">
        <h1>
          <SettingsIcon size={22} /> 템플릿 설정
        </h1>
        <p className="muted save-hint">
          {state === 'saving' ? (
            <>
              <Loader2 size={13} className="spin" /> 저장 중…
            </>
          ) : state === 'saved' ? (
            <>
              <Check size={13} /> 자동 저장되었습니다
            </>
          ) : (
            '변경 사항은 자동으로 저장됩니다.'
          )}
        </p>
      </header>

      <section className="settings-card">
        <h2>기본 정보</h2>
        <Field label="아이콘">
          <div className="emoji-grid">
            {EMOJIS.map((e) => (
              <button key={e} type="button" disabled={readOnly} className={cx('emoji-choice', t.emoji === e && 'is-selected')} onClick={() => void save({ emoji: e })}>
                {e}
              </button>
            ))}
          </div>
        </Field>
        <Field label="이름" error={!name.trim() ? '이름을 입력해 주세요' : undefined}>
          <input
            className="input"
            value={name}
            disabled={readOnly}
            maxLength={60}
            onChange={(e) => {
              setName(e.target.value);
              debounced({ name: e.target.value });
            }}
          />
        </Field>
        <Field label="설명">
          <textarea
            className="input"
            rows={2}
            value={description}
            disabled={readOnly}
            maxLength={200}
            onChange={(e) => {
              setDescription(e.target.value);
              debounced({ description: e.target.value });
            }}
          />
        </Field>
      </section>

      <section className="settings-card">
        <h2>사용할 기능</h2>
        <p className="muted small">여러 기능을 함께 켜면 한 템플릿에서 디자인·코딩·문서 작업을 동시에 진행할 수 있습니다.</p>
        <div className="feature-picker compact">
          {FEATURE_ORDER.map((f) => {
            const on = t.features.includes(f);
            return (
              <button key={f} type="button" disabled={readOnly} className={cx('feature-card', `feature-${f}`, on && 'is-on')} aria-pressed={on} onClick={() => toggleFeature(f)}>
                <span className="feature-check">{on && <Check size={14} />}</span>
                <span className="feature-emoji">{FEATURE_INFO[f].emoji}</span>
                <b>{FEATURE_INFO[f].name}</b>
                <span className="feature-desc">{FEATURE_INFO[f].description}</span>
              </button>
            );
          })}
        </div>
      </section>

      {t.myRole === 'owner' && (
        <section className="settings-card danger-zone">
          <h2>위험 구역</h2>
          <div className="danger-row">
            <div>
              <b>템플릿 삭제</b>
              <span className="muted small">모든 데이터가 영구적으로 삭제됩니다.</span>
            </div>
            <Button variant="danger" icon={<Trash2 size={14} />} onClick={removeTemplate}>
              삭제
            </Button>
          </div>
        </section>
      )}
    </CursorPage>
  );
}
