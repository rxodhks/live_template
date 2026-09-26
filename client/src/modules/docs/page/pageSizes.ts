import { PX_PER_UNIT, type PageSetup, type PageUnit } from '@shared/schema';

/*
 * 문서 크기 형식 — 일러스트레이터 · 포토샵의 '새 문서'처럼 종이 · 기기 화면 · 발표 · SNS 크기를 고른다
 * 기기 크기는 CSS 픽셀(브라우저가 쓰는 크기) 기준
 */

export interface PagePreset {
  id: string;
  name: string;
  /** 세로 방향 기준 너비 · 높이 */
  width: number;
  height: number;
  unit: PageUnit;
  margin: number;
  fontSize: number;
  /** 원래 가로로 쓰는 형식 (처음 고를 때 가로) */
  landscape?: boolean;
  note?: string;
}

export interface PageCategory {
  id: string;
  name: string;
  hint: string;
  presets: PagePreset[];
}

const print = (id: string, name: string, w: number, h: number, unit: PageUnit = 'mm', extra: Partial<PagePreset> = {}): PagePreset => ({
  id,
  name,
  width: w,
  height: h,
  unit,
  margin: unit === 'in' ? 0.75 : 20,
  fontSize: 15,
  ...extra,
});
const screen = (id: string, name: string, w: number, h: number, margin: number, fontSize: number, extra: Partial<PagePreset> = {}): PagePreset => ({
  id,
  name,
  width: w,
  height: h,
  unit: 'px',
  margin,
  fontSize,
  ...extra,
});

export const PAGE_CATEGORIES: PageCategory[] = [
  {
    id: 'print',
    name: '인쇄',
    hint: '종이 크기 — 인쇄 · PDF 저장이 이 크기로 나뉩니다',
    presets: [
      print('a4', 'A4', 210, 297),
      print('a3', 'A3', 297, 420),
      print('a5', 'A5', 148, 210, 'mm', { margin: 15 }),
      print('a6', 'A6', 105, 148, 'mm', { margin: 10, fontSize: 13 }),
      print('b4', 'B4 (JIS)', 257, 364),
      print('b5', 'B5 (JIS)', 182, 257, 'mm', { margin: 18 }),
      print('letter', 'Letter', 8.5, 11, 'in', { note: '미국 · 캐나다' }),
      print('legal', 'Legal', 8.5, 14, 'in'),
      print('tabloid', 'Tabloid', 11, 17, 'in'),
      print('a2', 'A2 포스터', 420, 594, 'mm', { margin: 30, fontSize: 24 }),
      print('card', '명함', 50, 90, 'mm', { margin: 5, fontSize: 11, landscape: true }),
      print('postcard', '엽서', 100, 148, 'mm', { margin: 8, fontSize: 13 }),
    ],
  },
  {
    id: 'mobile',
    name: '모바일',
    hint: '휴대폰 화면 (CSS 픽셀)',
    presets: [
      screen('iphone-16', 'iPhone 16', 393, 852, 20, 16),
      screen('iphone-16-pro', 'iPhone 16 Pro', 402, 874, 20, 16),
      screen('iphone-16-pro-max', 'iPhone 16 Pro Max', 440, 956, 20, 16),
      screen('iphone-se', 'iPhone SE', 375, 667, 16, 15),
      screen('galaxy-s24', 'Galaxy S24', 360, 780, 16, 15),
      screen('galaxy-s24-ultra', 'Galaxy S24 Ultra', 384, 824, 16, 16),
      screen('pixel-9', 'Pixel 9', 412, 923, 18, 16),
      screen('android', 'Android 기본', 360, 800, 16, 15),
    ],
  },
  {
    id: 'tablet',
    name: '태블릿',
    hint: '태블릿 화면 (CSS 픽셀)',
    presets: [
      screen('ipad', 'iPad', 820, 1180, 40, 17),
      screen('ipad-mini', 'iPad mini', 744, 1133, 36, 17),
      screen('ipad-pro-11', 'iPad Pro 11"', 834, 1210, 40, 17),
      screen('ipad-pro-13', 'iPad Pro 13"', 1032, 1376, 48, 18),
      screen('galaxy-tab-s9', 'Galaxy Tab S9', 800, 1280, 40, 17),
    ],
  },
  {
    id: 'desktop',
    name: '웹 · 데스크톱',
    hint: '모니터 · 노트북 화면',
    presets: [
      screen('fhd', 'Full HD', 1080, 1920, 64, 18, { landscape: true, note: '1920 × 1080' }),
      screen('macbook-air', 'MacBook Air 13"', 900, 1440, 56, 17, { landscape: true }),
      screen('laptop', '노트북', 864, 1536, 56, 17, { landscape: true }),
      screen('hd', 'HD', 768, 1366, 48, 16, { landscape: true }),
      screen('qhd', 'QHD', 1440, 2560, 80, 22, { landscape: true }),
    ],
  },
  {
    id: 'slides',
    name: '발표 · SNS',
    hint: '슬라이드 · 게시물 · 썸네일',
    presets: [
      screen('slide-16-9', '슬라이드 16:9', 1080, 1920, 96, 32, { landscape: true }),
      screen('slide-4-3', '슬라이드 4:3', 768, 1024, 64, 24, { landscape: true }),
      screen('insta-square', '인스타그램 정사각', 1080, 1080, 80, 36),
      screen('insta-portrait', '인스타그램 세로', 1080, 1350, 80, 36),
      screen('story', '스토리 · 릴스', 1080, 1920, 96, 40),
      screen('youtube-thumb', '유튜브 썸네일', 720, 1280, 64, 40, { landscape: true }),
    ],
  },
];

export const ALL_PRESETS = PAGE_CATEGORIES.flatMap((c) => c.presets);

export const UNIT_NAMES: Record<PageUnit, string> = { px: 'px 픽셀', mm: 'mm', cm: 'cm', in: 'in 인치', pt: 'pt 포인트' };

/** 단위 바꾸기 (소수 둘째 자리까지) */
export function convert(value: number, from: PageUnit, to: PageUnit): number {
  const v = (value * PX_PER_UNIT[from]) / PX_PER_UNIT[to];
  return to === 'px' ? Math.round(v) : Math.round(v * 100) / 100;
}

export const toPx = (value: number, unit: PageUnit) => value * PX_PER_UNIT[unit];

/** 형식을 방향에 맞춰 페이지 설정으로 */
export function setupFromPreset(p: PagePreset, landscape = Boolean(p.landscape)): PageSetup {
  const [w, h] = landscape ? [Math.max(p.width, p.height), Math.min(p.width, p.height)] : [Math.min(p.width, p.height), Math.max(p.width, p.height)];
  return { preset: p.id, width: w, height: h, unit: p.unit, margin: p.margin, fontSize: p.fontSize };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** "A4 · 210 × 297 mm" 같은 설명 */
export function describePage(page: PageSetup | null): string {
  if (!page) return '자유 형식';
  const preset = ALL_PRESETS.find((p) => p.id === page.preset);
  const size = `${fmt(page.width)} × ${fmt(page.height)} ${page.unit}`;
  return preset ? `${preset.name} · ${size}` : `직접 입력 · ${size}`;
}

export const isLandscape = (page: PageSetup) => page.width > page.height;

/** 화면에 그릴 크기 (CSS px) */
export function pagePx(page: PageSetup) {
  return {
    width: toPx(page.width, page.unit),
    height: toPx(page.height, page.unit),
    margin: toPx(page.margin, page.unit),
  };
}

/** 인쇄 · PDF 저장용 @page 규칙 */
export function pageCss(page: PageSetup): string {
  return `@page { size: ${fmt(page.width)}${page.unit} ${fmt(page.height)}${page.unit}; margin: ${fmt(page.margin)}${page.unit}; }`;
}
