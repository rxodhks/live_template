import * as Y from 'yjs';
import { getBoards, getDocs, getFiles, languageFromFilename, type PageSetup, type PageUnit, type SeedBlock, type Shape, type YItem } from './schema';

/*
 * 생성 헬퍼 (서버 시드 + 클라이언트 공용)
 * yjs 런타임을 쓰므로 schema.ts와 나눠, 목록만 읽는 화면(대시보드 등)은 yjs 없이 뜨게 한다
 */

export interface NewCodeFile {
  id: string;
  name: string;
  language?: string;
  content?: string;
  createdBy: string;
  createdAt?: number;
}

export function addCodeFile(doc: Y.Doc, f: NewCodeFile): YItem {
  const map = new Y.Map<unknown>();
  doc.transact(() => {
    getFiles(doc).set(f.id, map);
    map.set('id', f.id);
    map.set('name', f.name);
    map.set('language', f.language ?? languageFromFilename(f.name).id);
    map.set('createdAt', f.createdAt ?? Date.now());
    map.set('createdBy', f.createdBy);
    map.set('content', new Y.Text(f.content ?? ''));
  });
  return map;
}

function para(text: string): Y.XmlElement {
  const p = new Y.XmlElement('paragraph');
  if (text) p.insert(0, [new Y.XmlText(text)]);
  return p;
}

function blockToXml(block: SeedBlock): Y.XmlElement {
  switch (block.type) {
    case 'heading': {
      const h = new Y.XmlElement('heading');
      h.setAttribute('level', block.level as unknown as string);
      h.insert(0, [new Y.XmlText(block.text)]);
      return h;
    }
    case 'paragraph':
      return para(block.text);
    case 'bullet':
    case 'ordered': {
      const list = new Y.XmlElement(block.type === 'bullet' ? 'bulletList' : 'orderedList');
      if (block.type === 'ordered') list.setAttribute('start', 1 as unknown as string);
      list.insert(
        0,
        block.items.map((text) => {
          const li = new Y.XmlElement('listItem');
          li.insert(0, [para(text)]);
          return li;
        }),
      );
      return list;
    }
    case 'task': {
      const list = new Y.XmlElement('taskList');
      list.insert(
        0,
        block.items.map((item) => {
          const li = new Y.XmlElement('taskItem');
          li.setAttribute('checked', Boolean(item.checked) as unknown as string);
          li.insert(0, [para(item.text)]);
          return li;
        }),
      );
      return list;
    }
    case 'quote': {
      const q = new Y.XmlElement('blockquote');
      q.insert(0, [para(block.text)]);
      return q;
    }
    case 'code': {
      const c = new Y.XmlElement('codeBlock');
      c.setAttribute('language', (block.language ?? null) as unknown as string);
      c.insert(0, [new Y.XmlText(block.text)]);
      return c;
    }
    case 'rule':
      return new Y.XmlElement('horizontalRule');
  }
}

export interface NewDocument {
  id: string;
  title: string;
  emoji?: string;
  blocks?: SeedBlock[];
  /** 페이지 크기 (없으면 자유 형식) */
  page?: PageSetup | null;
  createdBy: string;
  createdAt?: number;
}

export function addDocument(doc: Y.Doc, d: NewDocument): YItem {
  const map = new Y.Map<unknown>();
  doc.transact(() => {
    getDocs(doc).set(d.id, map);
    map.set('id', d.id);
    map.set('title', d.title);
    map.set('emoji', d.emoji ?? '📄');
    map.set('createdAt', d.createdAt ?? Date.now());
    map.set('createdBy', d.createdBy);
    if (d.page) map.set('page', d.page);
    const fragment = new Y.XmlFragment();
    map.set('content', fragment);
    const blocks = d.blocks?.length ? d.blocks : [{ type: 'paragraph', text: '' } as SeedBlock];
    fragment.insert(0, blocks.map(blockToXml));
  });
  return map;
}

export interface NewBoard {
  id: string;
  name: string;
  background?: string;
  /** 속성 패널의 기본 크기 단위 (A4 보드는 mm처럼 처음 고른 형식의 단위) */
  unit?: PageUnit;
  shapes?: Shape[];
  createdBy: string;
  createdAt?: number;
}

export function addBoard(doc: Y.Doc, b: NewBoard): YItem {
  const map = new Y.Map<unknown>();
  doc.transact(() => {
    getBoards(doc).set(b.id, map);
    map.set('id', b.id);
    map.set('name', b.name);
    map.set('background', b.background ?? '');
    if (b.unit) map.set('unit', b.unit);
    map.set('createdAt', b.createdAt ?? Date.now());
    map.set('createdBy', b.createdBy);
    const shapes = new Y.Map<Shape>();
    map.set('shapes', shapes);
    for (const s of b.shapes ?? []) shapes.set(s.id, s);
  });
  return map;
}
