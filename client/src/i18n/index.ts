/*
 * 화면 언어 (한국어 · 영어)
 *
 * 화면 문구는 한국어 문장을 그대로 열쇠로 쓴다: t('저장') → 한국어 화면은 '저장', 영어 화면은 en.ts의 'Save'.
 *  · 한국어 화면은 사전을 받지 않는다 (첫 화면 용량 그대로)
 *  · 영어 화면은 영어 사전(en/)을 따로 받고, 받을 때까지 첫 화면을 그리지 않는다 (main.tsx가 ready를 기다린다)
 *  · 그래서 첫 화면 코드의 모듈 최상위에서는 t()를 부르지 않는다 — 함수 안에서 부른다 (지연 로딩 화면은 사전이 온 뒤에 실행되므로 괜찮다)
 *  · 언어는 페이지를 여는 동안 바뀌지 않는다 — 바꾸면 새로고침한다
 * 빠진 번역은 scripts/i18n-check.mjs(npm run i18n)가 찾는다.
 */
import { Fragment, createElement, type ReactNode } from 'react';

export type Lang = 'ko' | 'en';
export type Vars = Record<string, string | number>;
/** 사전 항목 — 단수 · 복수처럼 값에 따라 문장이 달라지면 함수 */
export type Entry = string | ((v: Vars) => string);
export type Dict = Record<string, Entry>;

export const LANG_KEY = 'lt.lang';
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'ko', label: '한국어' }, // i18n-ignore
  { id: 'en', label: 'English' },
];

/** 고른 언어 → 없으면 브라우저 언어 (한국어 브라우저가 아니면 영어). index.html의 첫 스크립트와 같은 규칙 */
function detect(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'ko' || saved === 'en') return saved;
  } catch {
    /* 저장소를 못 쓰면 브라우저 언어 */
  }
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language ?? 'ko'];
  return /^ko\b/i.test(prefs[0] ?? 'ko') ? 'ko' : 'en';
}

export const lang: Lang = detect();
export const isEn = lang === 'en';
/** 날짜 · 숫자 표기 */
export const locale = isEn ? 'en-US' : 'ko-KR';

let dict: Dict | null = null;
/** 영어 타임라인 문장 (shared/activity.ts의 영어판) */
export let activityEn: typeof import('./en').ACTIVITY_EN | null = null;
if (typeof document !== 'undefined') document.documentElement.lang = lang;

/**
 * 영어 화면이면 사전을 받는다. 한국어 화면은 아무것도 받지 않는다.
 * (모듈 최상위 await로 기다리면 번들러가 첫 화면을 잘게 나눠 한국어 화면까지 무거워져서, 기다리는 일은 main.tsx가 한다)
 * 받지 못하면 한국어로 연다 — 화면이 아예 안 뜨는 것보다 낫다.
 */
export const ready: Promise<void> = isEn
  ? import('./en')
      .then((m) => {
        dict = m.EN;
        activityEn = m.ACTIVITY_EN;
      })
      .catch((err) => console.error('영어 사전을 받지 못했습니다', err))
  : Promise.resolve();
/** 템플릿 모양의 열쇠({n} 등)를 서버 메시지에서 찾기 위한 정규식 — 처음 쓸 때 만든다 */
let patterns: { re: RegExp; names: string[]; entry: Entry }[] | null = null;

/**
 * 첫 화면 코드의 모듈 최상위에 두는 문구 표 · 목록 — 처음 읽을 때 만든다.
 * 모듈이 실행되는 때는 영어 사전이 오기 전이라, 그 자리에서 t()를 부르면 한국어로 굳는다.
 *   const LABEL = lazyText(() => ({ a: t("가") }));   const LIST = lazyText(() => [ … ], []);
 */
export function lazyText<T extends object>(make: () => T, shape: object = {}): T {
  let value: T | undefined;
  const real = (): object => (value ??= make());
  return new Proxy(shape, {
    get: (_, key) => {
      const v = Reflect.get(real(), key);
      return typeof v === 'function' ? v.bind(real()) : v;
    },
    has: (_, key) => key in real(),
    ownKeys: () => Reflect.ownKeys(real()),
    getOwnPropertyDescriptor: (target, key) => {
      const d = Reflect.getOwnPropertyDescriptor(real(), key);
      return d && !Reflect.getOwnPropertyDescriptor(target, key) ? { ...d, configurable: true } : d;
    },
  }) as T;
}

/** 언어를 바꾸고 새로고침한다 */
export function setLanguage(next: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    /* 저장하지 못하면 이번 한 번만 */
  }
  if (next !== lang) window.location.reload();
}

const fill = (s: string, v?: Vars) => (v ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m)) : s);

/**
 * 화면 문구: 한국어 원문 → 지금 언어. {이름} 자리에 vars 값을 넣는다.
 * 같은 한국어가 영어로는 달라야 하면 뒤에 '#쓰임'을 붙인다: t('문서#page') → 한국어 '문서', 영어 'Doc' (t('문서')는 'Docs')
 */
export function t(ko: string, vars?: Vars): string {
  const e = dict?.[ko];
  if (e === undefined) return fill(ko.replace(/#\w+$/, ''), vars);
  return typeof e === 'function' ? e(vars ?? {}) : fill(e, vars);
}

/** 문구 가운데 일부가 링크 · 굵은 글씨 같은 요소일 때: tr('{link}로 알려 주세요', { link: <a>…</a> }) */
export function tr(ko: string, vars: Record<string, ReactNode>): ReactNode {
  const text = dict?.[ko];
  const s = typeof text === 'string' ? text : ko;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(/\{(\w+)\}/g)) {
    parts.push(s.slice(last, m.index));
    parts.push(m[1] in vars ? vars[m[1]] : m[0]);
    last = m.index + m[0].length;
  }
  parts.push(s.slice(last));
  return createElement(Fragment, null, ...parts);
}

/** 서버 메시지의 값 자리: 그 자체가 사전에 있는 낱말이면 옮긴다 ('디자인, 코딩' 같은 목록도) */
function translateValue(s: string): string {
  const one = (x: string) => {
    const e = dict?.[x];
    return typeof e === 'string' ? e : x;
  };
  return s.includes(', ') ? s.split(', ').map(one).join(', ') : one(s);
}

/**
 * 기록으로 남기는 한국어 문구 (타임라인 활동의 detail 등): 지금 언어로 옮기지 않고 한국어 그대로 저장한다.
 * 보는 사람의 화면이 translateServer()로 옮긴다. 문구는 영어 사전에 있어야 한다 (npm run i18n이 확인).
 */
export const ko = (s: string, vars?: Vars): string => fill(s, vars);

/**
 * 서버가 보낸 한국어 메시지(오류 등)를 지금 언어로. 서버 문구도 영어 사전에 있다 (scripts/i18n-check.mjs가 확인).
 * '{n}개' 같은 열쇠는 값 자리를 비워 둔 채 맞춰 본다.
 */
export function translateServer(msg: string): string {
  if (!dict || !msg) return msg;
  const exact = dict[msg];
  if (exact !== undefined) return typeof exact === 'function' ? exact({}) : exact;
  patterns ??= Object.entries(dict)
    .filter(([k]) => /\{\w+\}/.test(k) && /[^{}\w\s]/.test(k.replace(/\{\w+\}/g, '')))
    .map(([k, entry]) => {
      const names: string[] = [];
      const src = k
        .split(/(\{\w+\})/)
        .map((part) => {
          const m = /^\{(\w+)\}$/.exec(part);
          if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          names.push(m[1]);
          return '([\\s\\S]*?)';
        })
        .join('');
      return { re: new RegExp(`^${src}$`), names, entry };
    });
  for (const p of patterns) {
    const m = p.re.exec(msg);
    if (!m) continue;
    const vars: Vars = {};
    p.names.forEach((n, i) => (vars[n] = translateValue(m[i + 1])));
    return typeof p.entry === 'function' ? p.entry(vars) : fill(p.entry, vars);
  }
  return msg;
}

/**
 * 다른 사람 커서 옆 라벨 · 서버가 만든 "활동 · 대상" 라벨: 통째로 사전에 있으면 그대로, 아니면 앞부분만 옮긴다
 * (예: '파일 생성 · main.js' → 'Created file · main.js')
 */
export function translateLabel(label: string): string {
  if (!dict) return label;
  const whole = translateServer(label);
  if (whole !== label) return whole;
  const i = label.indexOf(' · ');
  return i > 0 ? `${translateServer(label.slice(0, i))}${label.slice(i)}` : label;
}

/** 서버가 정한 기기 이름 ('삼성 인터넷 · Android', '패스키') */
export const deviceName = (name: string): string => (dict ? name.split(' · ').map(translateServer).join(' · ') : name);

/** 활동 detail 한 조각 — 통째로 없으면 '편집자 · 7일간 · 3회'처럼 ' · '로 나눠 옮긴다 */
function translateDetail(part: string): string {
  const whole = translateServer(part);
  return whole === part && part.includes(' · ') ? part.split(' · ').map(translateServer).join(' · ') : whole;
}

/** 타임라인 · 알림 문장 — 서버는 한국어로 기록하므로 영어 화면은 종류 · 대상으로 다시 만든다 */
export function activityText(e: { type: string; text: string; targetName?: string; detail?: string }): string {
  const en = activityEn?.[e.type as keyof NonNullable<typeof activityEn>];
  // detail은 '이름 → A, 설명 수정'처럼 여러 변경을 쉼표로 이어 붙인 한국어
  return en ? en.text(e.targetName ?? '', (e.detail ?? '').split(', ').map(translateDetail).join(', ')) : e.text;
}

/** 활동 종류의 짧은 라벨 (ko: shared/activity.ts의 라벨) */
export function activityLabel(type: string, ko: string): string {
  return activityEn?.[type as keyof NonNullable<typeof activityEn>]?.label ?? ko;
}
