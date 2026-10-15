import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import type { Feature } from '@shared/types';
import { FEATURE_INFO, FEATURE_ORDER } from '@shared/presets';
import { useWorkspace } from './context';
import { enableFeature } from './actions';
import { useSession } from '../store/session';
import { toast } from '../store/toasts';
import { errorMessage } from '../lib/api';
import { updateTemplate } from '../lib/templateOps';
import { VersionHistory, confirmTrash, trashTemplate } from '../components/DataProtection';
import { cx } from '../lib/util';
import { CursorPage } from '../components/Cursors';
import { Button, Field, confirmDialog } from '../components/ui';
import { t } from '../i18n';

const EMOJIS = ['🗂️', '🚀', '🎨', '💻', '📝', '🧭', '🌐', '🧪', '📊', '🎯', '🛠️', '💡', '📚', '🎮', '🏝️', '🔥'];

/** 템플릿 설정 — 입력하면 잠시 후 자동 저장 */
export function Settings() {
  const ws = useWorkspace();
  const tpl = ws.template;
  const me = useSession((s) => s.user)!;
  const navigate = useNavigate();
  const [name, setName] = useState(tpl.name);
  const [description, setDescription] = useState(tpl.description);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 다른 사람이 바꾸면 반영 (내가 입력 중이 아닐 때)
  useEffect(() => {
    if (!timer.current) {
      setName(tpl.name);
      setDescription(tpl.description);
    }
  }, [tpl.name, tpl.description]);

  const save = async (patch: Partial<{ name: string; description: string; emoji: string; features: Feature[] }>) => {
    setState('saving');
    try {
      await updateTemplate(tpl, patch);
      setState('saved');
      return true;
    } catch (err) {
      toast.error(t('설정을 저장하지 못했습니다'), errorMessage(err));
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
    const on = tpl.features.includes(f);
    if (on && tpl.features.length === 1) {
      toast.warning(t('기능은 하나 이상 필요합니다'));
      return;
    }
    if (on) {
      const ok = await confirmDialog({
        title: t('{name} 기능을 끌까요?', { name: t(FEATURE_INFO[f].name) }),
        message: t('내용은 삭제되지 않고 숨겨지기만 합니다. 다시 켜면 그대로 돌아옵니다.'),
        confirmText: t('끄기'),
      });
      if (!ok) return;
    }
    if (!on) {
      // 켜기: 지웠던 기본 목록을 되살리고, 비어 있으면 첫 페이지를 하나 만들어 준다
      setState('saving');
      const done = await enableFeature(ws, f, me);
      setState(done ? 'saved' : 'idle');
      return;
    }
    if (await save({ features: tpl.features.filter((x) => x !== f) })) toast.success(t('{name} 기능을 껐습니다', { name: t(FEATURE_INFO[f].name) }));
  };

  const removeTemplate = async () => {
    if (!(await confirmTrash(tpl))) return;
    if (await trashTemplate(tpl)) navigate('/');
  };

  const readOnly = !ws.canEdit;

  return (
    <CursorPage>
      <header className="page-header">
        <h1>
          <SettingsIcon size={22} /> {t('템플릿 설정')}
        </h1>
        <p className="muted save-hint">
          {state === 'saving' ? (
            <>
              <Loader2 size={13} className="spin" /> {t('저장 중…')}
            </>
          ) : state === 'saved' ? (
            <>
              <Check size={13} /> {t('자동 저장되었습니다')}
            </>
          ) : (
            t('변경 사항은 자동으로 저장됩니다.')
          )}
        </p>
      </header>

      <section className="settings-card">
        <h2>{t('기본 정보')}</h2>
        <Field label={t('아이콘')}>
          <div className="emoji-grid">
            {EMOJIS.map((e) => (
              <button key={e} type="button" disabled={readOnly} className={cx('emoji-choice', tpl.emoji === e && 'is-selected')} onClick={() => void save({ emoji: e })}>
                {e}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('이름')} error={!name.trim() ? t('이름을 입력해 주세요') : undefined}>
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
        <Field label={t('설명')}>
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
        <h2>{t('사용할 기능')}</h2>
        <p className="muted small">{t('여러 기능을 함께 켜면 한 템플릿에서 디자인·코딩·문서 작업을 동시에 진행할 수 있습니다.')}</p>
        <div className="feature-picker compact">
          {FEATURE_ORDER.map((f) => {
            const on = tpl.features.includes(f);
            return (
              <button key={f} type="button" disabled={readOnly} className={cx('feature-card', `feature-${f}`, on && 'is-on')} aria-pressed={on} onClick={() => toggleFeature(f)}>
                <span className="feature-check">{on && <Check size={14} />}</span>
                <span className="feature-emoji">{FEATURE_INFO[f].emoji}</span>
                <b>{t(FEATURE_INFO[f].name)}</b>
                <span className="feature-desc">{t(FEATURE_INFO[f].description)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {ws.mode === 'shared' && ws.canEdit && <VersionHistory template={tpl} />}

      {tpl.myRole === 'owner' && (
        <section className="settings-card danger-zone">
          <h2>{t('위험 구역')}</h2>
          <div className="danger-row">
            <div>
              <b>{t('템플릿 삭제')}</b>
              <span className="muted small">{t('휴지통으로 옮겨지며 30일 안에 복원할 수 있습니다. 그 뒤 영구 삭제됩니다.')}</span>
            </div>
            <Button variant="danger" icon={<Trash2 size={14} />} onClick={removeTemplate}>
              {t('휴지통으로 이동')}
            </Button>
          </div>
        </section>
      )}
    </CursorPage>
  );
}
