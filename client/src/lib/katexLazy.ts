import type { KatexOptions } from 'katex';

type Katex = typeof import('katex').default;

let katex: Katex | undefined;
let loading: Promise<Katex> | undefined;

/** katex와 스타일은 수식이 처음 그려질 때 한 번만 불러온다 */
export function loadKatex(): Promise<Katex> {
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => (katex = m.default));
  return loading;
}

/**
 * @tiptap/extension-mathematics가 쓰는 `katex.render`만 흉내 낸다 (vite 설정에서 이 모듈로 바꿔 끼운다).
 * katex가 아직 없으면 원문을 잠깐 보여 주고, 불러온 뒤 같은 요소에 다시 그린다.
 */
export default {
  render(latex: string, el: HTMLElement, options?: KatexOptions) {
    if (katex) return katex.render(latex, el, options);
    el.textContent = latex;
    void loadKatex().then(
      (k) => {
        try {
          k.render(latex, el, options);
        } catch {
          // throwOnError를 꺼 두지 않은 경우 — 원문 그대로 둔다
        }
      },
      (err: unknown) => console.warn('수식 렌더러(katex)를 불러오지 못했습니다', err),
    );
  },
};
