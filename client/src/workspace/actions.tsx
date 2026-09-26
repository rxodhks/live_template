import * as Y from 'yjs';
import type { Feature, PublicUser } from '@shared/types';
import { BLANK_CONTENT, FEATURE_INFO } from '@shared/presets';
import {
  addBoard,
  addCodeFile,
  addDocument,
  getBoards,
  getDocs,
  getFiles,
  languageFromFilename,
  readPageSetup,
  type Shape,
  type YItem,
} from '@shared/schema';
import { newId } from '../lib/util';
import { lastPageSetup, pageSetupDialog } from '../modules/docs/page/PageSetupDialog';
import { ALL_PRESETS, describePage, pagePx } from '../modules/docs/page/pageSizes';
import { errorMessage } from '../lib/api';
import { updateTemplate } from '../lib/templateOps';
import { confirmDialog, promptDialog } from '../components/ui';
import { toast } from '../store/toasts';
import { useTemplates } from '../store/templates';
import type { WorkspaceValue } from './context';
import { placeNewPage, restoreBuiltinSection } from './layout';

export type ItemModule = 'code' | 'docs' | 'design';

const NAME_KEY: Record<ItemModule, string> = { code: 'name', docs: 'title', design: 'name' };
const NOUN: Record<ItemModule, string> = { code: '파일', docs: '문서', design: '보드' };

export function itemsMap(doc: Y.Doc, module: ItemModule): Y.Map<YItem> {
  return module === 'code' ? getFiles(doc) : module === 'docs' ? getDocs(doc) : getBoards(doc);
}

export function itemLabel(item: YItem, module: ItemModule): string {
  return (item.get(NAME_KEY[module]) as string) ?? '';
}

function guard(ws: WorkspaceValue): boolean {
  if (ws.canEdit) return true;
  toast.warning('읽기 전용', '뷰어 권한으로는 편집할 수 없습니다.');
  return false;
}

/** 새 페이지를 넣을 목록 (없으면 그 종류의 기본 목록) */
export interface CreateOptions {
  sectionId?: string;
}

/**
 * 이 종류의 페이지를 쓸 수 있게 영역(기능)을 켠다 — 템플릿 안에서 바로 문서 · 디자인 · 코딩을 추가할 수 있도록.
 * 꺼져 있었으면 켜고, 지웠던 기본 목록도 되살린다. 켜진 뒤의 기능 목록을 돌려준다 (실패하면 null)
 */
export async function ensureFeature(ws: WorkspaceValue, module: ItemModule, opts: { quiet?: boolean } = {}): Promise<Feature[] | null> {
  const t = useTemplates.getState().templates[ws.template.id] ?? ws.template;
  if (t.features.includes(module)) return t.features;
  try {
    const next = await updateTemplate(t, { features: [...t.features, module] });
    restoreBuiltinSection(ws.doc, module);
    if (!opts.quiet) toast.success(`${FEATURE_INFO[module].name} 영역을 추가했습니다`, '왼쪽 목록과 메뉴에 바로 나타납니다.');
    return next.features;
  } catch (err) {
    toast.error(`${FEATURE_INFO[module].name} 영역을 추가하지 못했습니다`, errorMessage(err));
    return null;
  }
}

const currentFeatures = (ws: WorkspaceValue): Feature[] => (useTemplates.getState().templates[ws.template.id] ?? ws.template).features;
const areaNote = (added: boolean, m: ItemModule) => (added ? ` · ${FEATURE_INFO[m].name} 영역도 함께 추가했습니다` : '');

/** 영역을 켜고, 비어 있으면 첫 페이지를 하나 만들어 준다 (설정 · 개요의 영역 추가) */
export async function enableFeature(ws: WorkspaceValue, module: ItemModule, me: PublicUser): Promise<boolean> {
  const features = await ensureFeature(ws, module);
  if (!features) return false;
  const doc = ws.doc;
  if (module === 'code' && getFiles(doc).size === 0) {
    const c = BLANK_CONTENT.code[0];
    addCodeFile(doc, { id: newId(), name: c.name, content: c.content, createdBy: me.id });
  }
  if (module === 'docs' && getDocs(doc).size === 0) {
    const d = BLANK_CONTENT.docs[0];
    addDocument(doc, { id: newId(), title: d.title, emoji: d.emoji, blocks: d.blocks, createdBy: me.id });
  }
  if (module === 'design' && getBoards(doc).size === 0) addBoard(doc, { id: newId(), name: '보드 1', createdBy: me.id });
  return true;
}

/** 종류에 맞는 새 페이지 만들기 */
export function createPage(ws: WorkspaceValue, module: ItemModule, me: PublicUser, opts: CreateOptions = {}): Promise<void> {
  return module === 'code' ? createCodeFile(ws, me, opts) : module === 'docs' ? createDocument(ws, me, opts) : createBoard(ws, me, opts);
}

export async function createCodeFile(ws: WorkspaceValue, me: PublicUser, opts: CreateOptions = {}): Promise<void> {
  if (!guard(ws)) return;
  const names = new Set(Array.from(getFiles(ws.doc).values()).map((f) => String(f.get('name')).toLowerCase()));
  const raw = await promptDialog({
    title: '새 파일',
    label: '파일 이름 · 확장자로 언어가 자동 선택됩니다',
    placeholder: '예) app.ts, main.py, index.html',
    confirmText: '만들기',
    validate: (v) => {
      const name = v.includes('.') ? v : `${v}.js`;
      if (names.has(name.toLowerCase())) return '같은 이름의 파일이 이미 있습니다.';
      if (/[\\/:*?"<>|]/.test(v)) return '파일 이름에 사용할 수 없는 문자가 있습니다.';
      return null;
    },
  });
  if (!raw) return;
  const added = !currentFeatures(ws).includes('code');
  const features = await ensureFeature(ws, 'code', { quiet: true });
  if (!features) return;
  const name = raw.includes('.') ? raw : `${raw}.js`;
  const id = newId();
  addCodeFile(ws.doc, { id, name, language: languageFromFilename(name).id, createdBy: me.id });
  placeNewPage(ws.doc, features, 'code', id, opts.sectionId);
  ws.report({ type: 'code.create', targetId: id, targetName: name });
  toast.success('파일을 만들었습니다', `${name} · ${languageFromFilename(name).name}${areaNote(added, 'code')}`);
  ws.go('code', id);
}

export async function createDocument(ws: WorkspaceValue, me: PublicUser, opts: CreateOptions = {}): Promise<void> {
  if (!guard(ws)) return;
  // 먼저 문서 크기(A4 · 기기 화면 · 직접 입력 · 자유 형식)를 고른다
  const count = getDocs(ws.doc).size;
  const fallback = count === 0 ? '제목 없는 문서' : `제목 없는 문서 ${count + 1}`;
  const chosen = await pageSetupDialog({ mode: 'create', initial: lastPageSetup(), title: '' });
  if (!chosen) return;
  const added = !currentFeatures(ws).includes('docs');
  const features = await ensureFeature(ws, 'docs', { quiet: true });
  if (!features) return;
  const id = newId();
  const title = chosen.title || fallback;
  addDocument(ws.doc, { id, title, emoji: '📄', createdBy: me.id, page: chosen.page, blocks: [{ type: 'heading', level: 1, text: '' }] });
  placeNewPage(ws.doc, features, 'docs', id, opts.sectionId);
  ws.report({ type: 'docs.create', targetId: id, targetName: title, detail: describePage(chosen.page) });
  toast.success('문서를 만들었습니다', `${title} · ${describePage(chosen.page)}${areaNote(added, 'docs')}`);
  ws.go('docs', id);
}

export async function createBoard(ws: WorkspaceValue, me: PublicUser, opts: CreateOptions = {}): Promise<void> {
  if (!guard(ws)) return;
  // 자유 캔버스 또는 정해진 크기(iPhone · A4 · 슬라이드 …)의 아트보드로 시작
  const chosen = await pageSetupDialog({ mode: 'create', kind: 'board', initial: lastPageSetup('board'), title: '' });
  if (!chosen) return;
  const added = !currentFeatures(ws).includes('design');
  const features = await ensureFeature(ws, 'design', { quiet: true });
  if (!features) return;
  const id = newId();
  const names = new Set(Array.from(getBoards(ws.doc).values()).map((b) => b.get('name')));
  let n = getBoards(ws.doc).size + 1;
  while (names.has(`보드 ${n}`)) n++;
  const name = chosen.title || `보드 ${n}`;
  const page = chosen.page;
  const size = page ? pagePx(page) : null;
  const preset = page ? ALL_PRESETS.find((p) => p.id === page.preset) : undefined;
  const shapes: Shape[] = size
    ? [
        {
          id: newId(),
          type: 'frame',
          x: 0,
          y: 0,
          w: Math.round(size.width),
          h: Math.round(size.height),
          fill: '#ffffff',
          stroke: 'transparent',
          strokeWidth: 0,
          opacity: 1,
          z: 0,
          name: preset?.name ?? '아트보드',
          preset: page!.preset,
          createdBy: me.id,
        },
      ]
    : [];
  addBoard(ws.doc, { id, name, createdBy: me.id, shapes });
  placeNewPage(ws.doc, features, 'design', id, opts.sectionId);
  ws.report({ type: 'design.create', targetId: id, targetName: name, detail: page ? describePage(page) : '자유 캔버스' });
  toast.success('보드를 만들었습니다', `${name} · ${page ? describePage(page) : '자유 캔버스'}${areaNote(added, 'design')}`);
  ws.go('design', id);
}

export function renameItem(ws: WorkspaceValue, module: ItemModule, id: string, next: string): void {
  if (!guard(ws)) return;
  const item = itemsMap(ws.doc, module).get(id);
  if (!item) return;
  const prev = itemLabel(item, module);
  if (!next || prev === next) return;
  if (module === 'code') {
    const dup = Array.from(getFiles(ws.doc).values()).some((f) => f !== item && String(f.get('name')).toLowerCase() === next.toLowerCase());
    if (dup) {
      toast.warning('이름 변경 실패', '같은 이름의 파일이 이미 있습니다.');
      return;
    }
  }
  ws.doc.transact(() => {
    item.set(NAME_KEY[module], next);
    // 확장자가 바뀌면 언어도 따라간다
    if (module === 'code') {
      const prevLang = languageFromFilename(prev);
      const nextLang = languageFromFilename(next);
      if (prevLang.id !== nextLang.id && nextLang.id !== 'plaintext') item.set('language', nextLang.id);
    }
  });
  const type = module === 'code' ? 'code.rename' : module === 'docs' ? 'docs.rename' : 'design.rename';
  ws.report({ type, targetId: id, targetName: next, detail: `${prev} → ${next}` });
  ws.action(`이름 변경 · ${next}`);
}

export async function deleteItem(ws: WorkspaceValue, module: ItemModule, id: string): Promise<void> {
  if (!guard(ws)) return;
  const map = itemsMap(ws.doc, module);
  const item = map.get(id);
  if (!item) return;
  const name = itemLabel(item, module);
  const ok = await confirmDialog({
    title: `${NOUN[module]}를 삭제할까요?`,
    message: (
      <>
        <b>{name}</b> {NOUN[module]}가 모든 사용자에게서 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
      </>
    ),
    confirmText: '삭제',
    danger: true,
  });
  if (!ok) return;
  map.delete(id);
  const type = module === 'code' ? 'code.delete' : module === 'docs' ? 'docs.delete' : 'design.delete';
  ws.report({ type, targetId: id, targetName: name });
  toast.show({ kind: 'danger', title: `${NOUN[module]}를 삭제했습니다`, message: name });
  if (ws.view.module === module && ws.view.itemId === id) ws.go(module);
}

export function duplicateItem(ws: WorkspaceValue, module: ItemModule, id: string, me: PublicUser): void {
  if (!guard(ws)) return;
  const item = itemsMap(ws.doc, module).get(id);
  if (!item) return;
  const newItemId = newId();
  const base = itemLabel(item, module);
  if (module === 'code') {
    const dot = base.lastIndexOf('.');
    const names = new Set(Array.from(getFiles(ws.doc).values()).map((f) => String(f.get('name'))));
    let i = 1;
    let name = '';
    do {
      name = dot > 0 ? `${base.slice(0, dot)}-복사본${i > 1 ? i : ''}${base.slice(dot)}` : `${base}-복사본${i > 1 ? i : ''}`;
      i++;
    } while (names.has(name));
    addCodeFile(ws.doc, {
      id: newItemId,
      name,
      language: item.get('language') as string,
      content: (item.get('content') as Y.Text).toString(),
      createdBy: me.id,
    });
    ws.report({ type: 'code.create', targetId: newItemId, targetName: name });
  } else if (module === 'docs') {
    const title = `${base} (복사본)`;
    const map = new Y.Map<unknown>();
    ws.doc.transact(() => {
      getDocs(ws.doc).set(newItemId, map);
      map.set('id', newItemId);
      map.set('title', title);
      map.set('emoji', item.get('emoji') ?? '📄');
      map.set('createdAt', Date.now());
      map.set('createdBy', me.id);
      // 페이지 크기도 그대로
      const page = readPageSetup(item.get('page'));
      if (page) map.set('page', page);
      const src = item.get('content') as Y.XmlFragment;
      const frag = new Y.XmlFragment();
      map.set('content', frag);
      frag.insert(0, src.toArray().map((n) => (n as Y.XmlElement).clone()));
    });
    ws.report({ type: 'docs.create', targetId: newItemId, targetName: title });
  } else {
    const name = `${base} (복사본)`;
    const shapes = Array.from((item.get('shapes') as Y.Map<Shape>).values()).map((s) => ({ ...s, id: newId() }));
    addBoard(ws.doc, { id: newItemId, name, background: item.get('background') as string, createdBy: me.id, shapes });
    ws.report({ type: 'design.create', targetId: newItemId, targetName: name });
  }
  toast.success(`${NOUN[module]}를 복제했습니다`);
  ws.go(module, newItemId);
}
