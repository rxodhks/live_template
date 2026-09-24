import { memo } from 'react';
import type { Shape } from '@shared/schema';
import { TEXT_FONT, boundsOf, lineHeight, wrapText } from './geometry';

interface Props {
  shape: Shape;
  /** 내보내기용: 선택용 히트 영역을 그리지 않는다 */
  exporting?: boolean;
  zoom?: number;
  /** 텍스트 편집 중에는 SVG 글자를 숨기고 입력창을 겹쳐 보여준다 */
  hideText?: boolean;
}

const none = (c: string | undefined) => (!c || c === 'transparent' ? 'none' : c);

function ShapeText({ shape }: { shape: Shape }) {
  if (!shape.text) return null;
  const b = boundsOf(shape);
  const fontSize = shape.fontSize ?? 18;
  const pad = shape.type === 'text' ? 0 : shape.type === 'sticky' ? 14 : 10;
  const lines = wrapText(shape.text, fontSize, Math.max(10, b.w - pad * 2));
  const lh = lineHeight(fontSize);
  const align = shape.align ?? (shape.type === 'text' || shape.type === 'sticky' ? 'left' : 'center');
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const tx = align === 'left' ? b.x + pad : align === 'right' ? b.x + b.w - pad : b.x + b.w / 2;
  // 도형 안의 글은 세로 가운데, 텍스트/스티키는 위에서부터
  const top = shape.type === 'text' || shape.type === 'sticky' ? b.y + pad : b.y + (b.h - lines.length * lh) / 2;
  return (
    <text
      x={tx}
      y={top}
      fill={shape.textColor ?? '#1f2937'}
      fontSize={fontSize}
      fontFamily={TEXT_FONT}
      fontWeight={500}
      textAnchor={anchor}
      dominantBaseline="hanging"
      style={{ whiteSpace: 'pre' }}
    >
      {lines.map((l, i) => (
        <tspan key={i} x={tx} y={top + i * lh + (lh - fontSize) / 2}>
          {l || ' '}
        </tspan>
      ))}
    </text>
  );
}

function ArrowHead({ shape }: { shape: Shape }) {
  const x2 = shape.x + shape.w;
  const y2 = shape.y + shape.h;
  const angle = Math.atan2(shape.h, shape.w);
  const size = 10 + shape.strokeWidth * 2;
  const a1 = angle + Math.PI - Math.PI / 7;
  const a2 = angle + Math.PI + Math.PI / 7;
  const points = `${x2},${y2} ${x2 + Math.cos(a1) * size},${y2 + Math.sin(a1) * size} ${x2 + Math.cos(a2) * size},${y2 + Math.sin(a2) * size}`;
  return <polygon points={points} fill={none(shape.stroke)} stroke={none(shape.stroke)} strokeWidth={1} strokeLinejoin="round" />;
}

/** 도형 하나를 SVG로 그린다 (캔버스와 SVG/PNG 내보내기가 같은 코드를 사용) */
export const ShapeView = memo(function ShapeView({ shape, exporting, zoom = 1, hideText }: Props) {
  const b = boundsOf(shape);
  const common = {
    fill: none(shape.fill),
    stroke: none(shape.stroke),
    strokeWidth: shape.strokeWidth,
  };
  const hitWidth = Math.max(shape.strokeWidth, 12 / zoom);
  const data = exporting ? {} : { 'data-shape-id': shape.id };
  let body: React.ReactNode;

  switch (shape.type) {
    case 'rect':
      body = <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={shape.radius ?? 0} {...common} />;
      break;
    case 'ellipse':
      body = <ellipse cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={b.w / 2} ry={b.h / 2} {...common} />;
      break;
    case 'diamond':
      body = (
        <polygon
          points={`${b.x + b.w / 2},${b.y} ${b.x + b.w},${b.y + b.h / 2} ${b.x + b.w / 2},${b.y + b.h} ${b.x},${b.y + b.h / 2}`}
          strokeLinejoin="round"
          {...common}
        />
      );
      break;
    case 'sticky':
      body = (
        <>
          {!exporting && <rect x={b.x + 2} y={b.y + 4} width={b.w} height={b.h} rx={4} fill="rgba(0,0,0,0.08)" />}
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={shape.radius ?? 4} fill={none(shape.fill)} stroke={none(shape.stroke)} strokeWidth={shape.strokeWidth} />
          <path d={`M${b.x + b.w - 18},${b.y + b.h} L${b.x + b.w},${b.y + b.h - 18} L${b.x + b.w},${b.y + b.h} Z`} fill="rgba(0,0,0,0.06)" />
        </>
      );
      break;
    case 'text':
      body = !exporting ? <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="transparent" /> : null;
      break;
    case 'line':
    case 'arrow':
      body = (
        <>
          {!exporting && <line x1={shape.x} y1={shape.y} x2={shape.x + shape.w} y2={shape.y + shape.h} stroke="transparent" strokeWidth={hitWidth} strokeLinecap="round" />}
          <line x1={shape.x} y1={shape.y} x2={shape.x + shape.w} y2={shape.y + shape.h} stroke={none(shape.stroke)} strokeWidth={shape.strokeWidth} strokeLinecap="round" />
          {shape.type === 'arrow' && <ArrowHead shape={shape} />}
        </>
      );
      break;
    case 'pen': {
      const pts = shape.points ?? [];
      let d = '';
      for (let i = 0; i < pts.length; i += 2) d += `${i === 0 ? 'M' : 'L'}${(b.x + pts[i] * b.w).toFixed(1)},${(b.y + pts[i + 1] * b.h).toFixed(1)} `;
      body = (
        <>
          {!exporting && <path d={d} fill="none" stroke="transparent" strokeWidth={hitWidth} strokeLinecap="round" strokeLinejoin="round" />}
          <path d={d} fill="none" stroke={none(shape.stroke)} strokeWidth={shape.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
      break;
    }
  }

  return (
    <g {...data} opacity={shape.opacity ?? 1} className={exporting ? undefined : 'shape'}>
      {body}
      {!hideText && <ShapeText shape={shape} />}
    </g>
  );
});
