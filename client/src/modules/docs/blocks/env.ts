/*
 * 문서 편집기가 바깥(작업 공간)에서 받는 정보 — 멘션할 사람 · 페이지, 페이지 열기, 이미지 올리기 허용 여부
 * 편집기는 한 번만 만들어지므로, 값이 바뀌어도 항상 최신을 읽도록 함수로 받는다.
 */
export type PageModule = 'docs' | 'code' | 'design';

export interface MentionPage {
  module: PageModule;
  id: string;
  title: string;
  emoji: string;
}

export interface MentionUser {
  id: string;
  name: string;
  avatar: string;
  color: string;
}

export interface DocEnv {
  /** 이미지 파일을 문서에 넣을 수 있는지 (비밀 노트는 암호문 크기 제한으로 주소만) */
  uploads: boolean;
  users(): MentionUser[];
  pages(): MentionPage[];
  openPage(module: PageModule, id: string): void;
  /** 페이지 · 사람 이름이 바뀌면 멘션 표시를 다시 그린다 */
  subscribe(fn: () => void): () => void;
}

export const EMPTY_ENV: DocEnv = {
  uploads: true,
  users: () => [],
  pages: () => [],
  openPage: () => {},
  subscribe: () => () => {},
};

export const PAGE_MODULE_NAME: Record<PageModule, string> = { docs: '문서', code: '코드', design: '디자인' };

/* 멘션 id: 사람 u:<id>, 페이지 p:<module>:<id>, 날짜 d:YYYY-MM-DD */
export type MentionRef = { kind: 'user'; id: string } | { kind: 'page'; module: PageModule; id: string } | { kind: 'date'; date: string };

export function parseMentionId(raw: string | null | undefined): MentionRef | null {
  if (!raw) return null;
  if (raw.startsWith('u:')) return { kind: 'user', id: raw.slice(2) };
  if (raw.startsWith('d:')) return { kind: 'date', date: raw.slice(2) };
  const m = /^p:(docs|code|design):(.+)$/.exec(raw);
  return m ? { kind: 'page', module: m[1] as PageModule, id: m[2] } : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 2026-09-26 → 2026년 9월 26일 (오늘 · 내일 · 어제는 그렇게) */
export function dateLabel(iso: string, now = new Date()): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const day = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
  const rel = day === 0 ? '오늘' : day === 1 ? '내일' : day === -1 ? '어제' : null;
  const text = `${y === now.getFullYear() ? '' : `${y}년 `}${m}월 ${d}일`;
  return rel ? `${rel} (${text})` : text;
}
