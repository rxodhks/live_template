import { useState } from 'react';
import { USER_AVATARS, USER_COLORS } from '@shared/colors';
import type { PublicUser } from '@shared/types';
import { Avatar, Field } from './ui';
import { cx } from '../lib/util';

export interface ProfileDraft {
  name: string;
  color: string;
  avatar: string;
}

export function useProfileDraft(initial?: Partial<PublicUser>) {
  return useState<ProfileDraft>({
    name: initial?.name ?? '',
    color: initial?.color ?? USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)],
    avatar: initial?.avatar ?? USER_AVATARS[Math.floor(Math.random() * USER_AVATARS.length)],
  });
}

/** 이름 · 커서 색상 · 아바타 선택 */
export function ProfileForm({ draft, onChange, onSubmit }: { draft: ProfileDraft; onChange: (d: ProfileDraft) => void; onSubmit?: () => void }) {
  return (
    <div className="profile-form">
      <div className="profile-preview">
        <Avatar user={{ id: 'preview', ...draft, name: draft.name || '나' }} size={64} tooltip={false} />
        <div className="profile-preview-cursor" style={{ ['--user-color' as string]: draft.color }}>
          <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden>
            <path d="M1.5 1.5 L1.5 16 L5.6 12.3 L8.4 18.4 L11 17.2 L8.3 11.2 L14 11.2 Z" fill={draft.color} stroke="white" strokeWidth="1.4" />
          </svg>
          <span className="remote-cursor-name">
            {draft.avatar} {draft.name || '이름'}
          </span>
          <span className="remote-cursor-action static">✏️ 입력 중</span>
        </div>
      </div>
      <Field label="표시 이름" hint="다른 사용자의 화면에서 커서 옆에 표시됩니다.">
        <input
          className="input"
          value={draft.name}
          maxLength={24}
          placeholder="예) 김민수"
          data-autofocus
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit?.()}
        />
      </Field>
      <Field label="커서 색상">
        <div className="swatches">
          {USER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={cx('swatch', draft.color === c && 'is-selected')}
              style={{ background: c }}
              aria-label={`색상 ${c}`}
              onClick={() => onChange({ ...draft, color: c })}
            />
          ))}
        </div>
      </Field>
      <Field label="아바타">
        <div className="avatar-picker">
          {USER_AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              className={cx('avatar-choice', draft.avatar === a && 'is-selected')}
              onClick={() => onChange({ ...draft, avatar: a })}
            >
              {a}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}
