import { useState } from 'react';
import { Check, LayoutTemplate } from 'lucide-react';
import type { Feature, TemplateSummary } from '@shared/types';
import { BLANK_CONTENT, FEATURE_INFO, FEATURE_ORDER, PRESETS, getPreset } from '@shared/presets';
import { api, errorMessage } from '../lib/api';
import { toast } from '../store/toasts';
import { useTemplates } from '../store/templates';
import { Button, Field, Modal } from '../components/ui';
import { cx } from '../lib/util';

const EMOJIS = ['🗂️', '🚀', '🎨', '💻', '📝', '🧭', '🌐', '🧪', '📊', '🎯', '🛠️', '💡', '📚', '🎮', '🏝️', '🔥'];

/**
 * 템플릿 만들기
 *  - 기능(디자인/코딩/문서)은 여러 개 선택 가능 → 하나의 템플릿에서 동시에 작업
 *  - 프리셋을 고르면 기능과 시작 내용이 채워진다 (기능은 다시 조정 가능)
 */
export function CreateTemplateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (t: TemplateSummary) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji] = useState('🗂️');
  const [presetId, setPresetId] = useState('blank');
  const [features, setFeatures] = useState<Feature[]>(['docs']);
  const [saving, setSaving] = useState(false);

  const preset = getPreset(presetId);

  const choosePreset = (id: string) => {
    const p = getPreset(id);
    setPresetId(id);
    if (id !== 'blank') {
      setFeatures(p.features);
      if (emoji === '🗂️' || EMOJIS.includes(emoji)) setEmoji(p.emoji);
      if (!name.trim()) setName(p.name);
    }
  };

  const toggleFeature = (f: Feature) =>
    setFeatures((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : FEATURE_ORDER.filter((x) => x === f || prev.includes(x))));

  const contents = FEATURE_ORDER.filter((f) => features.includes(f)).map((f) => {
    const items =
      f === 'code'
        ? (preset.code ?? BLANK_CONTENT.code).map((x) => x.name)
        : f === 'docs'
          ? (preset.docs ?? BLANK_CONTENT.docs).map((x) => x.title)
          : (preset.design ?? BLANK_CONTENT.design).map((x) => x.name);
    return { f, items };
  });

  const create = async () => {
    if (!name.trim() || features.length === 0) return;
    setSaving(true);
    try {
      const res = await api<{ template: TemplateSummary }>('POST', '/templates', { name, description, emoji, features, preset: presetId });
      useTemplates.getState().upsert(res.template);
      toast.success('템플릿을 만들었습니다', `${res.template.emoji} ${res.template.name}`);
      onCreated(res.template);
    } catch (err) {
      toast.error('템플릿을 만들지 못했습니다', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="새 템플릿 만들기"
      description="사용할 기능을 고르세요. 여러 개를 함께 선택하면 한 템플릿 안에서 동시에 작업할 수 있습니다."
      icon={<LayoutTemplate size={18} />}
      onClose={onClose}
      width={760}
      footer={
        <>
          <span className="footer-note">{features.length === 0 ? '기능을 하나 이상 선택해 주세요' : `${features.map((f) => FEATURE_INFO[f].name).join(' + ')} 템플릿`}</span>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" onClick={create} loading={saving} disabled={!name.trim() || features.length === 0}>
            만들기
          </Button>
        </>
      }
    >
      <div className="create-template">
        <div className="create-row">
          <Field label="아이콘">
            <div className="emoji-grid">
              {EMOJIS.map((e) => (
                <button key={e} type="button" className={cx('emoji-choice', emoji === e && 'is-selected')} onClick={() => setEmoji(e)}>
                  {e}
                </button>
              ))}
            </div>
          </Field>
          <div className="create-names">
            <Field label="템플릿 이름">
              <input className="input" value={name} maxLength={60} placeholder="예) 신규 서비스 런칭" onChange={(e) => setName(e.target.value)} data-autofocus />
            </Field>
            <Field label="설명 (선택)">
              <input className="input" value={description} maxLength={200} placeholder="팀원들이 알아야 할 한 줄 설명" onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="field-label">
          기능 선택 <span className="muted">· 중복 선택 가능</span>
        </div>
        <div className="feature-picker" role="group" aria-label="기능 선택">
          {FEATURE_ORDER.map((f) => {
            const info = FEATURE_INFO[f];
            const on = features.includes(f);
            return (
              <button key={f} type="button" className={cx('feature-card', `feature-${f}`, on && 'is-on')} aria-pressed={on} onClick={() => toggleFeature(f)}>
                <span className="feature-check">{on && <Check size={14} />}</span>
                <span className="feature-emoji">{info.emoji}</span>
                <b>{info.name}</b>
                <span className="feature-desc">{info.description}</span>
                <ul>
                  {info.tools.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        <div className="field-label">시작 프리셋</div>
        <div className="preset-list">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className={cx('preset', presetId === p.id && 'is-selected')} onClick={() => choosePreset(p.id)}>
              <span className="preset-emoji">{p.emoji}</span>
              <span className="preset-text">
                <b>{p.name}</b>
                <span>{p.description}</span>
              </span>
              <span className="preset-features">{p.features.map((f) => FEATURE_INFO[f].emoji).join(' ')}</span>
            </button>
          ))}
        </div>

        {contents.length > 0 && (
          <div className="create-preview">
            <span className="field-label">만들어질 내용</span>
            <div className="create-preview-items">
              {contents.map(({ f, items }) => (
                <div key={f} className={`preview-chip feature-${f}`}>
                  {FEATURE_INFO[f].emoji} {FEATURE_INFO[f].name}: {items.join(', ')}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
