/** 사용자 커서/아바타 색상 팔레트 (밝은/어두운 배경 모두에서 흰 글씨가 읽히는 채도) */
export const USER_COLORS = [
  '#e5484d',
  '#f76b15',
  '#d6a100',
  '#30a46c',
  '#12a594',
  '#0090ff',
  '#3e63dd',
  '#8e4ec6',
  '#d6409f',
  '#7c6f64',
];

export const USER_AVATARS = ['🦊', '🐼', '🐯', '🐨', '🐸', '🐙', '🦄', '🐳', '🦉', '🐧', '🐱', '🐶', '🦁', '🐰', '🐻', '🐝'];

export function pickColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
}

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
