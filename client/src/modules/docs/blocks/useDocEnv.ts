import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type * as Y from 'yjs';
import { getBoards, getDocs, getFiles } from '@shared/schema';
import { useWorkspace, viewPath } from '../../../workspace/context';
import type { DocEnv, MentionPage } from './env';

/** 작업 공간의 멤버 · 페이지를 문서 편집기에 넘긴다 (멘션 · 페이지 링크) */
export function useDocEnv(opts: { uploads: boolean }): DocEnv {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const members = ws.template.members;
  const templateId = ws.template.id;
  const doc = ws.doc;
  return useMemo<DocEnv>(
    () => ({
      uploads: opts.uploads,
      users: () => members.map((m) => ({ id: m.user.id, name: m.user.name, avatar: m.user.avatar, color: m.user.color })),
      pages: () => pagesOf(doc),
      openPage: (module, id) => navigate(viewPath(templateId, module, id)),
      subscribe: (fn) => {
        const maps = [getDocs(doc), getFiles(doc), getBoards(doc)];
        let t: ReturnType<typeof setTimeout> | undefined;
        // 제목 · 이름 변경만 보면 되므로 문서 내용 편집은 무시한다
        const onChange = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
          if (!events.some((e) => e.path.length <= 1)) return;
          clearTimeout(t);
          t = setTimeout(fn, 200);
        };
        for (const m of maps) m.observeDeep(onChange);
        return () => {
          clearTimeout(t);
          for (const m of maps) m.unobserveDeep(onChange);
        };
      },
    }),
    [opts.uploads, members, doc, templateId, navigate],
  );
}

function pagesOf(doc: Y.Doc): MentionPage[] {
  const out: MentionPage[] = [];
  getDocs(doc).forEach((d, id) => out.push({ module: 'docs', id, title: String(d.get('title') ?? '제목 없는 문서'), emoji: String(d.get('emoji') ?? '📄') }));
  getFiles(doc).forEach((f, id) => out.push({ module: 'code', id, title: String(f.get('name') ?? '파일'), emoji: '💻' }));
  getBoards(doc).forEach((b, id) => out.push({ module: 'design', id, title: String(b.get('name') ?? '보드'), emoji: '🎨' }));
  return out;
}
