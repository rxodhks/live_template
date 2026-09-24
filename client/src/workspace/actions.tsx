import * as Y from 'yjs';
import type { PublicUser } from '@shared/types';
import {
  addBoard,
  addCodeFile,
  addDocument,
  getBoards,
  getDocs,
  getFiles,
  languageFromFilename,
  type Shape,
  type YItem,
} from '@shared/schema';
import { newId } from '../lib/util';
import { confirmDialog, promptDialog } from '../components/ui';
import { toast } from '../store/toasts';
import type { WorkspaceValue } from './context';

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

export async function createCodeFile(ws: WorkspaceValue, me: PublicUser): Promise<void> {
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
  const name = raw.includes('.') ? raw : `${raw}.js`;
  const id = newId();
  addCodeFile(ws.doc, { id, name, language: languageFromFilename(name).id, createdBy: me.id });
  ws.report({ type: 'code.create', targetId: id, targetName: name });
  toast.success('파일을 만들었습니다', `${name} · ${languageFromFilename(name).name}`);
  ws.go('code', id);
}

export function createDocument(ws: WorkspaceValue, me: PublicUser): void {
  if (!guard(ws)) return;
  const id = newId();
  const count = getDocs(ws.doc).size;
  const title = count === 0 ? '제목 없는 문서' : `제목 없는 문서 ${count + 1}`;
  addDocument(ws.doc, { id, title, emoji: '📄', createdBy: me.id, blocks: [{ type: 'heading', level: 1, text: '' }] });
  ws.report({ type: 'docs.create', targetId: id, targetName: title });
  toast.success('문서를 만들었습니다', title);
  ws.go('docs', id);
}

export function createBoard(ws: WorkspaceValue, me: PublicUser): void {
  if (!guard(ws)) return;
  const id = newId();
  const names = new Set(Array.from(getBoards(ws.doc).values()).map((b) => b.get('name')));
  let n = getBoards(ws.doc).size + 1;
  while (names.has(`보드 ${n}`)) n++;
  const name = `보드 ${n}`;
  addBoard(ws.doc, { id, name, createdBy: me.id });
  ws.report({ type: 'design.create', targetId: id, targetName: name });
  toast.success('보드를 만들었습니다', name);
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
