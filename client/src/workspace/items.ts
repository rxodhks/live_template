import type * as Y from 'yjs';
import { getBoards, getDocs, getFiles, type YItem } from '@shared/schema';

/*
 * 코드 · 문서 · 디자인 목록 읽기 — yjs 런타임 없이 쓸 수 있어 상단 바(대시보드 포함)에서도 불러온다
 */

export type ItemModule = 'code' | 'docs' | 'design';

export const NAME_KEY: Record<ItemModule, string> = { code: 'name', docs: 'title', design: 'name' };

export function itemsMap(doc: Y.Doc, module: ItemModule): Y.Map<YItem> {
  return module === 'code' ? getFiles(doc) : module === 'docs' ? getDocs(doc) : getBoards(doc);
}

export function itemLabel(item: YItem, module: ItemModule): string {
  return (item.get(NAME_KEY[module]) as string) ?? '';
}
