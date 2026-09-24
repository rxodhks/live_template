import type { Feature } from './types';
import type { SeedBlock, Shape } from './schema';

/* 템플릿을 만들 때 고를 수 있는 시작 프리셋. 선택한 기능에 해당하는 내용만 시드된다. */

interface SeedFile {
  name: string;
  content: string;
  language?: string;
}
interface SeedDoc {
  title: string;
  emoji: string;
  blocks: SeedBlock[];
}
interface SeedBoard {
  name: string;
  shapes: Omit<Shape, 'id' | 'z'>[];
}

export interface Preset {
  id: string;
  name: string;
  emoji: string;
  description: string;
  features: Feature[];
  code?: SeedFile[];
  docs?: SeedDoc[];
  design?: SeedBoard[];
}

const base = { fill: '#ffffff', stroke: '#1f2937', strokeWidth: 2, opacity: 1 };

const sticky = (x: number, y: number, text: string, fill: string): Omit<Shape, 'id' | 'z'> => ({
  type: 'sticky',
  x,
  y,
  w: 180,
  h: 140,
  fill,
  stroke: 'transparent',
  strokeWidth: 0,
  opacity: 1,
  text,
  fontSize: 18,
  textColor: '#1f2937',
  align: 'left',
});

const label = (x: number, y: number, w: number, text: string, fontSize = 20): Omit<Shape, 'id' | 'z'> => ({
  type: 'text',
  x,
  y,
  w,
  h: fontSize * 1.6,
  fill: 'transparent',
  stroke: 'transparent',
  strokeWidth: 0,
  opacity: 1,
  text,
  fontSize,
  textColor: '#111827',
  align: 'left',
});

export const BLANK_CONTENT: Required<Pick<Preset, 'code' | 'docs' | 'design'>> = {
  code: [
    {
      name: 'main.js',
      content: "// 함께 코딩해 보세요! 상단의 ▶ 실행 버튼으로 JavaScript를 바로 실행할 수 있습니다.\nconsole.log('Hello, LiveTemplate!');\n",
    },
  ],
  docs: [
    {
      title: '제목 없는 문서',
      emoji: '📄',
      blocks: [
        { type: 'heading', level: 1, text: '새 문서' },
        { type: 'paragraph', text: '여기에 내용을 작성하세요. 여러 사람이 동시에 편집할 수 있습니다.' },
      ],
    },
  ],
  design: [{ name: '보드 1', shapes: [] }],
};

export const PRESETS: Preset[] = [
  {
    id: 'blank',
    name: '빈 템플릿',
    emoji: '✨',
    description: '선택한 기능만으로 깨끗하게 시작합니다.',
    features: ['docs'],
  },
  {
    id: 'web',
    name: '웹 프로젝트',
    emoji: '🌐',
    description: 'HTML/CSS/JS 파일과 README 문서. 실시간 미리보기 지원.',
    features: ['code', 'docs'],
    code: [
      {
        name: 'index.html',
        content:
          '<!doctype html>\n<html lang="ko">\n  <head>\n    <meta charset="utf-8" />\n    <title>Live Template</title>\n  </head>\n  <body>\n    <main class="card">\n      <h1>안녕하세요 👋</h1>\n      <p>이 페이지는 팀이 함께 만들고 있어요.</p>\n      <button id="like">좋아요 <span id="count">0</span></button>\n    </main>\n  </body>\n</html>\n',
      },
      {
        name: 'style.css',
        content:
          'body {\n  font-family: system-ui, sans-serif;\n  display: grid;\n  place-items: center;\n  min-height: 100vh;\n  margin: 0;\n  background: #f5f7fb;\n}\n\n.card {\n  padding: 32px 40px;\n  border-radius: 16px;\n  background: white;\n  box-shadow: 0 10px 30px rgb(0 0 0 / 0.08);\n  text-align: center;\n}\n\nbutton {\n  padding: 8px 16px;\n  border-radius: 999px;\n  border: 0;\n  background: #6366f1;\n  color: white;\n  font-size: 16px;\n  cursor: pointer;\n}\n',
      },
      {
        name: 'main.js',
        content:
          "const button = document.querySelector('#like');\nconst count = document.querySelector('#count');\nlet likes = 0;\n\nbutton?.addEventListener('click', () => {\n  likes += 1;\n  count.textContent = String(likes);\n});\n\nconsole.log('페이지가 준비되었습니다');\n",
      },
    ],
    docs: [
      {
        title: 'README',
        emoji: '📘',
        blocks: [
          { type: 'heading', level: 1, text: '웹 프로젝트' },
          { type: 'paragraph', text: '코딩 탭에서 index.html을 열고 “미리보기”를 누르면 결과를 바로 확인할 수 있습니다.' },
          { type: 'heading', level: 2, text: '할 일' },
          {
            type: 'task',
            items: [
              { text: '레이아웃 잡기', checked: true },
              { text: '좋아요 버튼 인터랙션' },
              { text: '반응형 스타일 적용' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'product',
    name: '제품 기획',
    emoji: '🧭',
    description: '와이어프레임 보드와 PRD 문서로 기획을 시작합니다.',
    features: ['design', 'docs'],
    design: [
      {
        name: '와이어프레임',
        shapes: [
          { ...base, type: 'rect', x: 80, y: 60, w: 720, h: 460, radius: 12, fill: '#ffffff', stroke: '#cbd5e1' },
          { ...base, type: 'rect', x: 80, y: 60, w: 720, h: 56, radius: 12, fill: '#eef2ff', stroke: '#c7d2fe' },
          label(104, 76, 260, '로고 · 내비게이션', 18),
          { ...base, type: 'rect', x: 104, y: 140, w: 160, h: 356, radius: 8, fill: '#f8fafc', stroke: '#e2e8f0' },
          label(120, 156, 130, '사이드바', 16),
          { ...base, type: 'rect', x: 288, y: 140, w: 240, h: 160, radius: 10, fill: '#fef3c7', stroke: '#fcd34d' },
          { ...base, type: 'rect', x: 544, y: 140, w: 232, h: 160, radius: 10, fill: '#dcfce7', stroke: '#86efac' },
          { ...base, type: 'rect', x: 288, y: 320, w: 488, h: 176, radius: 10, fill: '#e0f2fe', stroke: '#7dd3fc' },
          label(304, 156, 200, '핵심 지표 카드', 16),
          label(560, 156, 200, '최근 활동', 16),
          label(304, 336, 300, '메인 콘텐츠 영역', 16),
          { ...base, type: 'arrow', x: 860, y: 200, w: -70, h: 0, fill: 'transparent', stroke: '#ef4444', strokeWidth: 3 },
          sticky(870, 140, '카드 순서는\n사용자 설정 가능?', '#fde68a'),
        ],
      },
    ],
    docs: [
      {
        title: 'PRD · 제품 요구사항',
        emoji: '🧭',
        blocks: [
          { type: 'heading', level: 1, text: '제품 요구사항 정의서' },
          { type: 'quote', text: '한 문장 요약: 누구의 어떤 문제를 어떻게 해결하는가?' },
          { type: 'heading', level: 2, text: '배경과 문제' },
          { type: 'paragraph', text: '' },
          { type: 'heading', level: 2, text: '목표 / 비목표' },
          { type: 'bullet', items: ['목표: ', '비목표: '] },
          { type: 'heading', level: 2, text: '핵심 사용자 시나리오' },
          { type: 'ordered', items: ['사용자는 …', '시스템은 …'] },
          { type: 'heading', level: 2, text: '마일스톤' },
          { type: 'task', items: [{ text: '와이어프레임 확정' }, { text: '디자인 리뷰' }, { text: '개발 착수' }] },
        ],
      },
    ],
  },
  {
    id: 'hackathon',
    name: '해커톤',
    emoji: '🚀',
    description: '아이디어 보드 + 코드 + 회의록을 한 번에. 모든 기능 사용.',
    features: ['design', 'code', 'docs'],
    design: [
      {
        name: '아이디어 보드',
        shapes: [
          label(80, 40, 400, '💡 아이디어 브레인스토밍', 28),
          sticky(80, 110, 'AI 기반\n회의 요약', '#fde68a'),
          sticky(280, 110, '실시간\n화이트보드', '#bbf7d0'),
          sticky(480, 110, '음성 메모 →\n할 일 변환', '#bfdbfe'),
          sticky(80, 270, '팀 무드\n트래커', '#fbcfe8'),
          sticky(280, 270, '코드 리뷰\n게임화', '#ddd6fe'),
          { ...base, type: 'ellipse', x: 520, y: 300, w: 120, h: 80, fill: '#fee2e2', stroke: '#ef4444' },
          label(538, 326, 100, '투표!', 18),
        ],
      },
    ],
    code: [
      {
        name: 'app.py',
        content:
          'from dataclasses import dataclass\n\n\n@dataclass\nclass Idea:\n    title: str\n    votes: int = 0\n\n\nideas = [Idea("AI 회의 요약"), Idea("실시간 화이트보드")]\n\nfor idea in sorted(ideas, key=lambda i: -i.votes):\n    print(f"{idea.title}: {idea.votes}표")\n',
      },
      {
        name: 'vote.js',
        content:
          "const ideas = [\n  { title: 'AI 회의 요약', votes: 3 },\n  { title: '실시간 화이트보드', votes: 5 },\n  { title: '음성 메모 → 할 일', votes: 2 },\n];\n\nconst winner = ideas.reduce((a, b) => (a.votes >= b.votes ? a : b));\nconsole.table(ideas);\nconsole.log(`🏆 우승 아이디어: ${winner.title}`);\n",
      },
    ],
    docs: [
      {
        title: '회의록',
        emoji: '📝',
        blocks: [
          { type: 'heading', level: 1, text: '해커톤 킥오프 회의' },
          { type: 'paragraph', text: '참석자: ' },
          { type: 'heading', level: 2, text: '안건' },
          { type: 'bullet', items: ['주제 선정', '역할 분담', '일정 확인'] },
          { type: 'heading', level: 2, text: '결정 사항' },
          { type: 'paragraph', text: '' },
          { type: 'heading', level: 2, text: '액션 아이템' },
          { type: 'task', items: [{ text: '아이디어 투표 마감' }, { text: '프로토타입 초안' }] },
        ],
      },
    ],
  },
  {
    id: 'study',
    name: '코딩 스터디',
    emoji: '🧑‍💻',
    description: '알고리즘 풀이를 여러 언어로 함께 작성합니다.',
    features: ['code'],
    code: [
      {
        name: 'solution.js',
        content:
          '// 두 수의 합: nums에서 합이 target인 두 인덱스를 찾으세요.\nfunction twoSum(nums, target) {\n  const seen = new Map();\n  for (let i = 0; i < nums.length; i++) {\n    const need = target - nums[i];\n    if (seen.has(need)) return [seen.get(need), i];\n    seen.set(nums[i], i);\n  }\n  return [];\n}\n\nconsole.log(twoSum([2, 7, 11, 15], 9));\n',
      },
      {
        name: 'solution.py',
        content:
          'def two_sum(nums: list[int], target: int) -> list[int]:\n    seen: dict[int, int] = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n    return []\n\n\nprint(two_sum([2, 7, 11, 15], 9))\n',
      },
    ],
  },
  {
    id: 'meeting',
    name: '회의록',
    emoji: '🗓️',
    description: '안건, 결정 사항, 액션 아이템 양식이 준비된 문서.',
    features: ['docs'],
    docs: [
      {
        title: '주간 회의록',
        emoji: '🗓️',
        blocks: [
          { type: 'heading', level: 1, text: '주간 회의' },
          { type: 'paragraph', text: '일시: · 참석자: ' },
          { type: 'heading', level: 2, text: '지난주 리뷰' },
          { type: 'bullet', items: [''] },
          { type: 'heading', level: 2, text: '이번 주 안건' },
          { type: 'ordered', items: [''] },
          { type: 'heading', level: 2, text: '액션 아이템' },
          { type: 'task', items: [{ text: '' }] },
        ],
      },
    ],
  },
];

export function getPreset(id: string | undefined): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

export const FEATURE_INFO: Record<Feature, { name: string; emoji: string; description: string; tools: string[] }> = {
  design: {
    name: '디자인',
    emoji: '🎨',
    description: '무한 캔버스에서 도형·텍스트·스티키 노트로 함께 그립니다.',
    tools: ['도형/선/화살표/펜', '스티키 노트', '레이어 · 정렬', 'SVG/PNG 내보내기'],
  },
  code: {
    name: '코딩',
    emoji: '💻',
    description: '24개 언어 문법 강조, 파일별 언어 선택, 실시간 동시 편집.',
    tools: ['언어 선택 · 변경', '멀티 파일', 'JS 실행 · HTML 미리보기', '파일 다운로드'],
  },
  docs: {
    name: '문서',
    emoji: '📝',
    description: '리치 텍스트 문서를 동시에 작성합니다.',
    tools: ['제목/목록/체크리스트', '표 · 코드 블록', '목차(아웃라인)', 'Markdown/HTML 내보내기'],
  },
};

export const FEATURE_ORDER: Feature[] = ['design', 'code', 'docs'];
