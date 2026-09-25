import { useEffect, useReducer } from 'react';
import type * as Y from 'yjs';
import type { Feature } from '@shared/types';
import { FEATURE_INFO, FEATURE_ORDER } from '@shared/presets';
import { getSections, type SectionRecord, type YItem } from '@shared/schema';
import { newId } from '../lib/util';
import { itemLabel, itemsMap, type ItemModule } from './actions';

/*
 * 왼쪽 탐색기의 목록 구성
 *  - 처음에는 기능별 기본 목록(디자인 · 코딩 · 문서)에 그 종류의 페이지가 들어 있다
 *  - 사용자가 목록 이름 · 아이콘 · 순서를 바꾸고, 새 목록을 만들고, 페이지를 원하는 목록으로 옮길 수 있다
 *  - 구성은 템플릿 문서(Y.Doc)에 저장되어 함께 쓰는 사람 모두에게 실시간으로 같게 보인다
 *  - 목록을 지워도 페이지는 지워지지 않고 다른 목록으로 옮겨진다
 */

export const BUILTIN_SECTIONS: readonly ItemModule[] = FEATURE_ORDER;
const isBuiltin = (id: string): id is ItemModule => (BUILTIN_SECTIONS as readonly string[]).includes(id);

export const SECTION_EMOJIS = ['📁', '📂', '🗂️', '📌', '⭐', '🚀', '🎯', '💡', '🧪', '🛠️', '📚', '📝', '🎨', '💻', '📊', '✅', '🗓️', '🔖'];

export interface PageRef {
  module: ItemModule;
  id: string;
  item: YItem;
  order: number;
}

export interface SectionView {
  id: string;
  name: string;
  emoji: string;
  /** 기능별 기본 목록이면 그 기능 */
  builtin: ItemModule | null;
  order: number;
  pages: PageRef[];
}

const itemOrder = (item: YItem): number => {
  const o = item.get('order');
  return typeof o === 'number' && Number.isFinite(o) ? o : ((item.get('createdAt') as number) ?? 0);
};

/** 지금 보이는 목록과 그 안의 페이지 (순서대로) */
export function computeLayout(doc: Y.Doc, features: Feature[]): SectionView[] {
  const records = getSections(doc);
  const sections: SectionView[] = [];
  for (const f of BUILTIN_SECTIONS) {
    if (!features.includes(f)) continue;
    const r = records.get(f);
    if (r?.deleted) continue;
    sections.push({
      id: f,
      builtin: f,
      name: r?.name?.trim() || FEATURE_INFO[f].name,
      emoji: r?.emoji || FEATURE_INFO[f].emoji,
      order: typeof r?.order === 'number' ? r.order : BUILTIN_SECTIONS.indexOf(f),
      pages: [],
    });
  }
  records.forEach((r, id) => {
    if (isBuiltin(id) || !r || r.deleted || !r.name?.trim()) return;
    sections.push({ id, builtin: null, name: r.name.trim(), emoji: r.emoji || '📁', order: typeof r.order === 'number' ? r.order : 100, pages: [] });
  });
  sections.sort((a, b) => a.order - b.order || (a.builtin ? 0 : 1) - (b.builtin ? 0 : 1) || a.id.localeCompare(b.id));

  const byId = new Map(sections.map((s) => [s.id, s]));
  for (const f of BUILTIN_SECTIONS) {
    if (!features.includes(f)) continue;
    itemsMap(doc, f).forEach((item, id) => {
      const pref = item.get('section');
      const target = (typeof pref === 'string' && byId.get(pref)) || byId.get(f) || sections[0];
      if (!target) return;
      target.pages.push({ module: f, id, item, order: itemOrder(item) });
    });
  }
  for (const s of sections) {
    s.pages.sort((a, b) => a.order - b.order || ((a.item.get('createdAt') as number) ?? 0) - ((b.item.get('createdAt') as number) ?? 0) || a.id.localeCompare(b.id));
  }
  return sections;
}

/** 목록 구성이 바뀌면 (목록 · 페이지 추가/삭제 · 이름 · 이동) 다시 그린다. 본문 편집에는 반응하지 않는다 */
export function useLayout(doc: Y.Doc, features: Feature[]): SectionView[] {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const maps = [getSections(doc), ...BUILTIN_SECTIONS.map((m) => itemsMap(doc, m))];
    const observed = new Set<YItem>();
    const onItem = () => force();
    const sync = () => {
      for (const item of observed) item.unobserve(onItem);
      observed.clear();
      for (const m of BUILTIN_SECTIONS)
        itemsMap(doc, m).forEach((item) => {
          item.observe(onItem);
          observed.add(item);
        });
    };
    const onTop = () => {
      sync();
      force();
    };
    sync();
    for (const m of maps) m.observe(onTop);
    force();
    return () => {
      for (const m of maps) m.unobserve(onTop);
      for (const item of observed) item.unobserve(onItem);
    };
  }, [doc]);
  return computeLayout(doc, features);
}

/* ───────────── 순서 계산 ───────────── */

/** a와 b 사이의 순서 값. 자리가 없으면 null (그 목록을 다시 번호 매긴다) */
function between(a: number | undefined, b: number | undefined): number | null {
  if (a === undefined && b === undefined) return 1;
  if (a === undefined) return b! - 1;
  if (b === undefined) return a + 1;
  const mid = (a + b) / 2;
  return mid > a && mid < b ? mid : null;
}

/* ───────────── 목록 편집 ───────────── */

function writeSection(doc: Y.Doc, id: string, patch: SectionRecord) {
  const records = getSections(doc);
  const prev = records.get(id) ?? {};
  records.set(id, { ...prev, ...patch });
}

/** 새 목록을 만들고 ID를 돌려준다 (afterId 바로 아래, 없으면 맨 아래) */
export function createSection(doc: Y.Doc, features: Feature[], name: string, by: string, opts: { emoji?: string; afterId?: string } = {}): string {
  const sections = computeLayout(doc, features);
  const id = newId();
  let order: number;
  const idx = opts.afterId ? sections.findIndex((s) => s.id === opts.afterId) : -1;
  if (idx >= 0) {
    const o = between(sections[idx].order, sections[idx + 1]?.order);
    if (o === null) {
      doc.transact(() => renumberSections(doc, sections));
      return createSection(doc, features, name, by, opts);
    }
    order = o;
  } else {
    order = (sections.length ? Math.max(...sections.map((s) => s.order)) : 0) + 1;
  }
  writeSection(doc, id, { name: name.trim().slice(0, 40), emoji: opts.emoji ?? '📁', order, createdAt: Date.now(), createdBy: by });
  return id;
}

/** 목록 이름으로 쓸 수 있는 겹치지 않는 기본 이름 */
export function nextSectionName(doc: Y.Doc, features: Feature[]): string {
  const names = new Set(computeLayout(doc, features).map((s) => s.name));
  if (!names.has('새 목록')) return '새 목록';
  let n = 2;
  while (names.has(`새 목록 ${n}`)) n++;
  return `새 목록 ${n}`;
}

export function renameSection(doc: Y.Doc, id: string, name: string) {
  const v = name.trim().slice(0, 40);
  if (v) writeSection(doc, id, { name: v });
}

export function setSectionEmoji(doc: Y.Doc, id: string, emoji: string) {
  writeSection(doc, id, { emoji });
}

function renumberSections(doc: Y.Doc, sections: SectionView[]) {
  sections.forEach((s, i) => writeSection(doc, s.id, { order: i + 1 }));
}

/** 목록을 다른 목록 앞으로 (beforeId가 null이면 맨 아래로) */
export function moveSection(doc: Y.Doc, features: Feature[], id: string, beforeId: string | null) {
  const all = computeLayout(doc, features);
  const rest = all.filter((s) => s.id !== id);
  const at = beforeId ? rest.findIndex((s) => s.id === beforeId) : rest.length;
  if (at < 0) return;
  const order = between(rest[at - 1]?.order, rest[at]?.order);
  doc.transact(() => {
    if (order === null) {
      const next = [...rest.slice(0, at), all.find((s) => s.id === id)!, ...rest.slice(at)];
      renumberSections(doc, next);
    } else writeSection(doc, id, { order });
  });
}

/** 위(-1) / 아래(+1)로 한 칸 */
export function shiftSection(doc: Y.Doc, features: Feature[], id: string, dir: -1 | 1) {
  const all = computeLayout(doc, features);
  const i = all.findIndex((s) => s.id === id);
  if (i < 0) return;
  if (dir < 0 && i > 0) moveSection(doc, features, id, all[i - 1].id);
  if (dir > 0 && i < all.length - 1) moveSection(doc, features, id, all[i + 2]?.id ?? null);
}

/**
 * 목록 삭제 — 안의 페이지는 지우지 않고 옮긴다
 *  (자기 기능의 기본 목록이 있으면 그리로, 없으면 남은 첫 목록으로)
 * 옮겨진 곳을 돌려준다. 마지막 목록은 지울 수 없다 (null)
 */
export function deleteSection(doc: Y.Doc, features: Feature[], id: string): SectionView | null {
  const all = computeLayout(doc, features);
  const target = all.find((s) => s.id === id);
  const rest = all.filter((s) => s.id !== id);
  if (!target || rest.length === 0) return null;
  const fallback = rest[0];
  doc.transact(() => {
    let tail = fallback.pages.length ? fallback.pages[fallback.pages.length - 1].order : 0;
    for (const p of target.pages) {
      if (rest.some((s) => s.id === p.module)) p.item.delete('section');
      else {
        p.item.set('section', fallback.id);
        p.item.set('order', ++tail);
      }
    }
    if (isBuiltin(id)) writeSection(doc, id, { deleted: true });
    else getSections(doc).delete(id);
  });
  return fallback;
}

/** 삭제했던 기본 목록을 다시 보이게 한다 (기능을 새로 켤 때) */
export function restoreBuiltinSection(doc: Y.Doc, f: ItemModule) {
  const r = getSections(doc).get(f);
  if (r?.deleted) writeSection(doc, f, { deleted: false });
}

/** 목록 구성을 처음 상태(기능별 기본 목록)로 되돌린다 — 페이지는 그대로 */
export function resetLayout(doc: Y.Doc) {
  doc.transact(() => {
    getSections(doc).clear();
    for (const m of BUILTIN_SECTIONS)
      itemsMap(doc, m).forEach((item) => {
        item.delete('section');
        item.delete('order');
      });
  });
}

export function isCustomized(doc: Y.Doc): boolean {
  if (getSections(doc).size > 0) return true;
  return BUILTIN_SECTIONS.some((m) => Array.from(itemsMap(doc, m).values()).some((item) => item.has('section') || item.has('order')));
}

/* ───────────── 페이지 이동 ───────────── */

/** 페이지를 목록 안 원하는 자리로 (beforeId가 null이면 맨 아래) */
export function movePage(doc: Y.Doc, features: Feature[], module: ItemModule, id: string, sectionId: string, beforeId: string | null) {
  const all = computeLayout(doc, features);
  const section = all.find((s) => s.id === sectionId);
  const item = itemsMap(doc, module).get(id);
  if (!section || !item) return;
  const rest = section.pages.filter((p) => !(p.id === id && p.module === module));
  const at = beforeId ? rest.findIndex((p) => p.id === beforeId) : rest.length;
  if (at < 0) return;
  const order = between(rest[at - 1]?.order, rest[at]?.order);
  doc.transact(() => {
    if (sectionId === module) item.delete('section');
    else item.set('section', sectionId);
    if (order === null) {
      const next = [...rest.slice(0, at), { module, id, item, order: 0 }, ...rest.slice(at)];
      next.forEach((p, i) => p.item.set('order', i + 1));
    } else item.set('order', order);
  });
}

/** 새로 만든 페이지를 목록 맨 아래에 넣는다 */
export function placeNewPage(doc: Y.Doc, features: Feature[], module: ItemModule, id: string, sectionId: string | undefined) {
  if (!sectionId || sectionId === module) return;
  movePage(doc, features, module, id, sectionId, null);
}

export const pageLabel = (p: PageRef) => itemLabel(p.item, p.module);
