import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { getDocs } from '@shared/schema';
import { useWorkspace } from '../../workspace/context';
import { outlineOf, type OutlineEntry } from './yxml';

/** 탐색기에 붙는 문서 목차 (다른 사람이 제목을 바꿔도 실시간 반영) */
export function DocOutline({ docId }: { docId: string }) {
  const ws = useWorkspace();
  const fragment = getDocs(ws.doc).get(docId)?.get('content') as Y.XmlFragment | undefined;
  const [entries, setEntries] = useState<OutlineEntry[]>([]);

  useEffect(() => {
    if (!fragment) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(t);
      t = setTimeout(() => setEntries(outlineOf(fragment)), 250);
    };
    setEntries(outlineOf(fragment));
    fragment.observeDeep(update);
    return () => {
      clearTimeout(t);
      fragment.unobserveDeep(update);
    };
  }, [fragment]);

  if (!fragment) return null;
  if (entries.length === 0) return <p className="ex-empty">제목(H1~H3)을 추가하면 목차가 만들어집니다</p>;
  return (
    <ul className="outline">
      {entries.map((e) => (
        <li key={e.index} style={{ paddingLeft: (e.level - 1) * 12 }}>
          <button
            className={`outline-item level-${e.level}`}
            onClick={() => window.dispatchEvent(new CustomEvent('lt:doc-heading', { detail: { key: docId, index: e.index } }))}
          >
            {e.text || <span className="muted">(빈 제목)</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
