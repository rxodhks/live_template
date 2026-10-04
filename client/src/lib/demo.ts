import type { PublicUser, TemplateEntry } from '@shared/types';
import { PRESETS, getPreset } from '@shared/presets';
import { useTemplates } from '../store/templates';

/*
 * 가입 전 둘러보기 — 예시 템플릿을 로그인 없이 읽기 전용으로 연다.
 *  · 주소는 일반 템플릿과 같은 /t/demo-<프리셋>/… (안의 링크가 그대로 동작한다)
 *  · 내용은 프리셋으로 브라우저 메모리에만 만든다: 서버 · 브라우저 저장소(IndexedDB)에 쓰지 않는다
 *  · 코드 실행 · 미리보기는 방문자 브라우저에서 그대로 된다. 편집 · 만들기는 가입 안내
 */

const PREFIX = 'demo-';

/** 둘러보기에서 보여 줄 예시 (빈 템플릿 제외) */
export const DEMO_PRESETS = PRESETS.filter((p) => p.id !== 'blank');

export const isDemoId = (id: string | undefined): id is string => !!id && id.startsWith(PREFIX) && DEMO_PRESETS.some((p) => p.id === id.slice(PREFIX.length));
export const demoPath = (presetId: string) => `/t/${PREFIX}${presetId}`;
export const demoPresetId = (id: string) => id.slice(PREFIX.length);

/** 둘러보는 사람 (화면 곳곳이 '나'를 필요로 한다) */
export const GUEST: PublicUser = {
  id: 'guest',
  name: '둘러보는 중',
  color: '#64748b',
  avatar: '👀',
};
const MADANG: PublicUser = {
  id: 'madang',
  name: 'Madang',
  color: '#6262e0',
  avatar: '🏡',
};

/** 예시 템플릿 항목을 목록에 넣는다 (메모리에만 — 저장하지 않는다) */
export function putDemoEntry(id: string): TemplateEntry {
  const p = getPreset(demoPresetId(id));
  const at = Date.UTC(2026, 9, 1);
  const entry: TemplateEntry = {
    id,
    name: p.name,
    description: p.description,
    emoji: p.emoji,
    features: p.features,
    ownerId: MADANG.id,
    members: [{ user: MADANG, role: 'owner', joinedAt: at }],
    createdAt: at,
    updatedAt: at,
    myRole: 'viewer',
    visibility: 'private',
    mode: 'personal',
  };
  useTemplates.setState((s) => ({
    templates: { ...s.templates, [id]: entry },
  }));
  return entry;
}

/** 예시를 닫으면 목록에서 뺀다 (대시보드 · 템플릿 전환 목록에 남지 않게) */
export function dropDemoEntry(id: string): void {
  useTemplates.setState((s) => {
    if (!s.templates[id]) return s;
    const { [id]: _, ...rest } = s.templates;
    return { templates: rest };
  });
}
