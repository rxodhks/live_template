/// <reference lib="webworker" />
import { compileString } from 'sass';

// SCSS → CSS 변환 전용 워커 (Sass는 크기가 커서 필요할 때만 불러온다)
self.onmessage = (e: MessageEvent<{ id: number; text: string; name: string }>) => {
  const { id, text, name } = e.data;
  try {
    const r = compileString(text, { style: 'expanded', syntax: name.endsWith('.sass') ? 'indented' : 'scss' });
    postMessage({ id, ok: true, text: r.css });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    postMessage({ id, ok: false, text: `SCSS 오류: ${msg}` });
  }
};
