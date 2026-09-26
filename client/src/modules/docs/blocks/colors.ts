/*
 * 문서 글자 색 · 배경 색 (노션과 같은 9가지)
 * 색 값 대신 CSS 변수로 저장해 밝은 · 어두운 화면에서 각각 알맞은 색으로 보인다 (내보낸 HTML에도 변수를 함께 넣는다)
 */
export const DOC_COLORS = [
  { key: 'gray', name: '회색' },
  { key: 'brown', name: '갈색' },
  { key: 'orange', name: '주황' },
  { key: 'yellow', name: '노랑' },
  { key: 'green', name: '초록' },
  { key: 'blue', name: '파랑' },
  { key: 'purple', name: '보라' },
  { key: 'pink', name: '분홍' },
  { key: 'red', name: '빨강' },
] as const;

export type DocColorKey = (typeof DOC_COLORS)[number]['key'];

export const textColor = (key: DocColorKey) => `var(--dc-${key})`;
export const bgColor = (key: DocColorKey) => `var(--dcb-${key})`;

/** CSS 변수 이름에서 색 이름 (예: var(--dc-red) → red) */
export function colorKeyOf(value: string | null | undefined): DocColorKey | null {
  const m = /--dcb?-([a-z]+)/.exec(value ?? '');
  return m && DOC_COLORS.some((c) => c.key === m[1]) ? (m[1] as DocColorKey) : null;
}

/** 내보낸 HTML 문서에 넣을 색 변수 (밝은 화면 기준) */
export const DOC_COLOR_CSS = `:root{--dc-gray:#787774;--dc-brown:#9f6b53;--dc-orange:#d9730d;--dc-yellow:#cb912f;--dc-green:#448361;--dc-blue:#337ea9;--dc-purple:#9065b0;--dc-pink:#c14c8a;--dc-red:#d44c47;--dcb-gray:#f1f1ef;--dcb-brown:#f4eeee;--dcb-orange:#fbecdd;--dcb-yellow:#fbf3db;--dcb-green:#edf3ec;--dcb-blue:#e7f3f8;--dcb-purple:#f6f3f9;--dcb-pink:#faf1f5;--dcb-red:#fdebec}`;
