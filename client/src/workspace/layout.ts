import { useEffect, useReducer } from 'react';
import type * as Y from 'yjs';
import type { Feature } from '@shared/types';
import { FEATURE_INFO, FEATURE_ORDER } from '@shared/presets';
import { getSections, type SectionRecord, type YItem } from '@shared/schema';
import { newId } from '../lib/util';
import { itemLabel, itemsMap, type ItemModule } from './actions';

/*
 * 왼쪽 탐색기의 폴더 구성
 *  - 처음에는 기능별 기본 폴더(디자인 · 코딩 · 문서)에 그 종류의 페이지가 들어 있다
 *  - 사용자가 폴더 이름 · 아이콘 · 순서를 바꾸고, 새 폴더와 폴더 안의 폴더(하위 폴더)를 만들고,
 *    페이지를 원하는 폴더로 옮길 수 있다
 *  - 구성은 템플릿 문서(Y.Doc)에 저장되어 함께 쓰는 사람 모두에게 실시간으로 같게 보인다
 *  - 폴더를 지워도 안의 페이지와 하위 폴더는 지워지지 않고 상위 폴더(맨 위 폴더면 기본 폴더)로 옮겨진다
 */

export const BUILTIN_SECTIONS: readonly ItemModule[] = FEATURE_ORDER;
const isBuiltin = (id: string): id is ItemModule => (BUILTIN_SECTIONS as readonly string[]).includes(id);

/** 폴더를 몇 단계까지 넣을 수 있는지 (맨 위 폴더 = 1단계) */
export const MAX_FOLDER_DEPTH = 5;

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
  /** 기능별 기본 폴더면 그 기능 */
  builtin: ItemModule | null;
  order: number;
  /** 상위 폴더 (맨 위 폴더면 null) */
  parent: string | null;
  /** 0 = 맨 위 폴더 */
  depth: number;
  children: SectionView[];
  pages: PageRef[];
  /** 하위 폴더까지 포함한 페이지 수 */
  total: number;
}

export interface Layout {
  roots: SectionView[];
  /** 위에서 아래로 보이는 순서 (펼쳤을 때) */
  all: SectionView[];
  byId: Map<string, SectionView>;
}

const itemOrder = (item: YItem): number => {
  const o = item.get('order');
  return typeof o === 'number' && Number.isFinite(o) ? o : ((item.get('createdAt') as number) ?? 0);
};

const bySiblingOrder = (a: SectionView, b: SectionView) => a.order - b.order || (a.builtin ? 0 : 1) - (b.builtin ? 0 : 1) || a.id.localeCompare(b.id);

/** 지금 보이는 폴더 트리와 그 안의 페이지 (순서대로) */
export function computeLayout(doc: Y.Doc, features: Feature[]): Layout {
  const records = getSections(doc);
  const list: SectionView[] = [];
  const rawParent = new Map<string, unknown>();
  const base = (id: string, r: SectionRecord | undefined, builtin: ItemModule | null, name: string, emoji: string, order: number): SectionView => {
    rawParent.set(id, r?.parent);
    return { id, builtin, name, emoji, order, parent: null, depth: 0, children: [], pages: [], total: 0 };
  };
  for (const f of BUILTIN_SECTIONS) {
    if (!features.includes(f)) continue;
    const r = records.get(f);
    if (r?.deleted) continue;
    list.push(base(f, r, f, r?.name?.trim() || FEATURE_INFO[f].name, r?.emoji || FEATURE_INFO[f].emoji, typeof r?.order === 'number' ? r.order : BUILTIN_SECTIONS.indexOf(f)));
  }
  records.forEach((r, id) => {
    if (isBuiltin(id) || !r || r.deleted || !r.name?.trim()) return;
    list.push(base(id, r, null, r.name.trim(), r.emoji || '📁', typeof r.order === 'number' ? r.order : 100));
  });
  const byId = new Map(list.map((s) => [s.id, s]));

  // 상위 폴더: 없거나 보이지 않으면 맨 위로
  const parentOf = new Map<string, string | null>();
  for (const s of list) {
    const p = rawParent.get(s.id);
    parentOf.set(s.id, typeof p === 'string' && p !== s.id && byId.has(p) ? p : null);
  }
  // 여러 사람이 동시에 서로의 안으로 옮겨 고리가 생기면, 고리 안에서 ID가 가장 작은 폴더를 맨 위로 (모두에게 같은 결과)
  for (const s of list) {
    const seen = new Set<string>();
    let cur: string | null = s.id;
    while (cur) {
      if (seen.has(cur)) {
        const cycle: string[] = [];
        let x = cur;
        do {
          cycle.push(x);
          x = parentOf.get(x)!;
        } while (x !== cur);
        parentOf.set(cycle.sort()[0], null);
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
  }

  const roots: SectionView[] = [];
  for (const s of list) {
    s.parent = parentOf.get(s.id) ?? null;
    if (s.parent) byId.get(s.parent)!.children.push(s);
    else roots.push(s);
  }
  const all: SectionView[] = [];
  const walk = (nodes: SectionView[], depth: number) => {
    nodes.sort(bySiblingOrder);
    for (const n of nodes) {
      n.depth = depth;
      all.push(n);
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);

  for (const f of BUILTIN_SECTIONS) {
    if (!features.includes(f)) continue;
    itemsMap(doc, f).forEach((item, id) => {
      const pref = item.get('section');
      const target = (typeof pref === 'string' && byId.get(pref)) || byId.get(f) || roots[0];
      if (!target) return;
      target.pages.push({ module: f, id, item, order: itemOrder(item) });
    });
  }
  for (const s of all) {
    s.pages.sort((a, b) => a.order - b.order || ((a.item.get('createdAt') as number) ?? 0) - ((b.item.get('createdAt') as number) ?? 0) || a.id.localeCompare(b.id));
  }
  const count = (s: SectionView): number => (s.total = s.pages.length + s.children.reduce((n, c) => n + count(c), 0));
  roots.forEach(count);
  return { roots, all, byId };
}

/** 폴더 구성이 바뀌면 (폴더 · 페이지 추가/삭제 · 이름 · 이동) 다시 그린다. 본문 편집에는 반응하지 않는다 */
export function useLayout(doc: Y.Doc, features: Feature[]): Layout {
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

/* ───────────── 트리 도우미 ───────────── */

const siblingsOf = (layout: Layout, parentId: string | null): SectionView[] => (parentId ? (layout.byId.get(parentId)?.children ?? []) : layout.roots);

/** a가 b 자신이거나 b의 상위 폴더인지 */
export function isAncestorOrSelf(layout: Layout, a: string, b: string | null): boolean {
  let cur = b;
  while (cur) {
    if (cur === a) return true;
    cur = layout.byId.get(cur)?.parent ?? null;
  }
  return false;
}

/** 폴더 아래로 몇 단계가 더 있는지 (하위 폴더가 없으면 1) */
const heightOf = (s: SectionView): number => 1 + Math.max(0, ...s.children.map(heightOf));

/** id 폴더를 parentId 안에 넣을 수 있는지 (자기 안으로 넣거나 너무 깊어지면 안 된다) */
export function canNestInto(layout: Layout, id: string, parentId: string | null): boolean {
  if (parentId && isAncestorOrSelf(layout, id, parentId)) return false;
  const s = layout.byId.get(id);
  const parentDepth = parentId ? (layout.byId.get(parentId)?.depth ?? 0) + 1 : 0;
  return !s || parentDepth + heightOf(s) <= MAX_FOLDER_DEPTH;
}

/* ───────────── 순서 계산 ───────────── */

/** a와 b 사이의 순서 값. 자리가 없으면 null (형제 폴더를 다시 번호 매긴다) */
function between(a: number | undefined, b: number | undefined): number | null {
  if (a === undefined && b === undefined) return 1;
  if (a === undefined) return b! - 1;
  if (b === undefined) return a + 1;
  const mid = (a + b) / 2;
  return mid > a && mid < b ? mid : null;
}

/* ───────────── 폴더 편집 ───────────── */

function writeSection(doc: Y.Doc, id: string, patch: Partial<Record<keyof SectionRecord, unknown>>) {
  const records = getSections(doc);
  const next: Record<string, unknown> = { ...(records.get(id) ?? {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === null) delete next[k];
  records.set(id, next as SectionRecord);
}

/** 형제 폴더 순서를 1, 2, 3…으로 다시 매기고 상위 폴더도 함께 기록 */
function renumber(doc: Y.Doc, parentId: string | null, ids: string[]) {
  ids.forEach((id, i) => writeSection(doc, id, { order: i + 1, parent: parentId ?? undefined }));
}

/** 폴더를 parentId 안, beforeId 앞으로 (beforeId가 null이면 맨 아래) */
function placeSection(doc: Y.Doc, layout: Layout, id: string, parentId: string | null, beforeId: string | null) {
  const rest = siblingsOf(layout, parentId).filter((s) => s.id !== id);
  let at = beforeId ? rest.findIndex((s) => s.id === beforeId) : rest.length;
  if (at < 0) at = rest.length;
  const order = between(rest[at - 1]?.order, rest[at]?.order);
  if (order === null) renumber(doc, parentId, [...rest.slice(0, at).map((s) => s.id), id, ...rest.slice(at).map((s) => s.id)]);
  else writeSection(doc, id, { order, parent: parentId ?? undefined });
}

/** 새 폴더를 만들고 ID를 돌려준다 — parentId 안 맨 아래, 또는 afterId 바로 아래 (같은 상위 폴더) */
export function createSection(doc: Y.Doc, features: Feature[], name: string, by: string, opts: { emoji?: string; afterId?: string; parentId?: string | null } = {}): string {
  const layout = computeLayout(doc, features);
  const id = newId();
  const after = opts.afterId ? layout.byId.get(opts.afterId) : undefined;
  const parentId = after ? after.parent : (opts.parentId ?? null);
  doc.transact(() => {
    writeSection(doc, id, { name: name.trim().slice(0, 40), emoji: opts.emoji ?? '📁', createdAt: Date.now(), createdBy: by });
    const siblings = siblingsOf(layout, parentId);
    const beforeId = after ? (siblings[siblings.findIndex((s) => s.id === after.id) + 1]?.id ?? null) : null;
    placeSection(doc, layout, id, parentId, beforeId);
  });
  return id;
}

/** 폴더 이름으로 쓸 수 있는 겹치지 않는 기본 이름 */
export function nextSectionName(doc: Y.Doc, features: Feature[]): string {
  const names = new Set(computeLayout(doc, features).all.map((s) => s.name));
  if (!names.has('새 폴더')) return '새 폴더';
  let n = 2;
  while (names.has(`새 폴더 ${n}`)) n++;
  return `새 폴더 ${n}`;
}

export function renameSection(doc: Y.Doc, id: string, name: string) {
  const v = name.trim().slice(0, 40);
  if (v) writeSection(doc, id, { name: v });
}

export function setSectionEmoji(doc: Y.Doc, id: string, emoji: string) {
  writeSection(doc, id, { emoji });
}

/** 폴더를 parentId 안 beforeId 앞으로 옮긴다. 자기 안으로 넣거나 너무 깊어지면 false */
export function moveSection(doc: Y.Doc, features: Feature[], id: string, parentId: string | null, beforeId: string | null): boolean {
  const layout = computeLayout(doc, features);
  if (!layout.byId.has(id) || (parentId && !layout.byId.has(parentId)) || !canNestInto(layout, id, parentId)) return false;
  doc.transact(() => placeSection(doc, layout, id, parentId, beforeId));
  return true;
}

/** 같은 상위 폴더 안에서 위(-1) / 아래(+1)로 한 칸 */
export function shiftSection(doc: Y.Doc, features: Feature[], id: string, dir: -1 | 1) {
  const layout = computeLayout(doc, features);
  const s = layout.byId.get(id);
  if (!s) return;
  const sib = siblingsOf(layout, s.parent);
  const i = sib.findIndex((x) => x.id === id);
  if (dir < 0 && i > 0) moveSection(doc, features, id, s.parent, sib[i - 1].id);
  if (dir > 0 && i < sib.length - 1) moveSection(doc, features, id, s.parent, sib[i + 2]?.id ?? null);
}

/** 상위 폴더 밖으로 꺼낸다 (상위 폴더 바로 아래로) */
export function outdentSection(doc: Y.Doc, features: Feature[], id: string) {
  const layout = computeLayout(doc, features);
  const s = layout.byId.get(id);
  const parent = s?.parent ? layout.byId.get(s.parent) : undefined;
  if (!s || !parent) return;
  const sib = siblingsOf(layout, parent.parent);
  const next = sib[sib.findIndex((x) => x.id === parent.id) + 1]?.id ?? null;
  moveSection(doc, features, id, parent.parent, next);
}

export interface DeleteResult {
  /** 페이지가 옮겨진 폴더 이름 (상위 폴더가 있으면 그 이름) */
  movedTo: string;
  pages: number;
  folders: number;
}

/**
 * 폴더 삭제 — 안의 페이지와 하위 폴더는 지우지 않고 옮긴다
 *  - 하위 폴더: 지운 폴더 자리(상위 폴더 안)로 한 단계 올라간다
 *  - 페이지: 상위 폴더가 있으면 그 폴더로, 맨 위 폴더였으면 자기 종류의 기본 폴더(없으면 맨 위 첫 폴더)로
 * 마지막 폴더는 지울 수 없다 (null)
 */
export function deleteSection(doc: Y.Doc, features: Feature[], id: string): DeleteResult | null {
  const layout = computeLayout(doc, features);
  const target = layout.byId.get(id);
  if (!target || layout.all.length <= 1) return null;
  const parent = target.parent ? layout.byId.get(target.parent)! : null;
  const siblings = siblingsOf(layout, target.parent);
  const newSiblings = siblings.flatMap((s) => (s.id === id ? s.children : [s]));
  const fallback = parent ?? newSiblings[0] ?? null;
  if (!fallback) return null;
  doc.transact(() => {
    // 하위 폴더를 지운 폴더 자리로
    if (target.children.length) renumber(doc, target.parent, newSiblings.map((s) => s.id));
    // 페이지
    let tail = fallback.pages.length ? fallback.pages[fallback.pages.length - 1].order : 0;
    for (const p of target.pages) {
      const home = !parent && p.module !== id && layout.byId.has(p.module);
      if (home) p.item.delete('section');
      else {
        p.item.set('section', fallback.id);
        p.item.set('order', ++tail);
      }
    }
    if (isBuiltin(id)) writeSection(doc, id, { deleted: true, parent: undefined });
    else getSections(doc).delete(id);
  });
  return { movedTo: parent ? parent.name : '', pages: target.pages.length, folders: target.children.length };
}

/** 삭제했던 기본 폴더를 다시 보이게 한다 (기능을 새로 켤 때) */
export function restoreBuiltinSection(doc: Y.Doc, f: ItemModule) {
  const r = getSections(doc).get(f);
  if (r?.deleted) writeSection(doc, f, { deleted: undefined });
}

/** 폴더 구성을 처음 상태(기능별 기본 폴더)로 되돌린다 — 페이지는 그대로 */
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

/** 페이지를 폴더 안 원하는 자리로 (beforeId가 null이면 맨 아래) */
export function movePage(doc: Y.Doc, features: Feature[], module: ItemModule, id: string, sectionId: string, beforeId: string | null) {
  const layout = computeLayout(doc, features);
  const section = layout.byId.get(sectionId);
  const item = itemsMap(doc, module).get(id);
  if (!section || !item) return;
  const rest = section.pages.filter((p) => !(p.id === id && p.module === module));
  let at = beforeId ? rest.findIndex((p) => p.id === beforeId) : rest.length;
  if (at < 0) at = rest.length;
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

/** 새로 만든 페이지를 폴더 맨 아래에 넣는다 */
export function placeNewPage(doc: Y.Doc, features: Feature[], module: ItemModule, id: string, sectionId: string | undefined) {
  if (!sectionId || sectionId === module) return;
  movePage(doc, features, module, id, sectionId, null);
}

export const pageLabel = (p: PageRef) => itemLabel(p.item, p.module);
