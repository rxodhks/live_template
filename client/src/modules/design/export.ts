import { createElement } from 'react';
import type { Shape } from '@shared/schema';
import { downloadBlob } from '../../lib/util';
import { boundsOf, intersects, unionBounds } from './geometry';
import { ShapeView } from './ShapeView';

/** 보드를 독립적인 SVG 문서로 만든다 (ShapeView를 그대로 재사용) */
export async function boardToSvg(shapes: Shape[], background: string): Promise<{ svg: string; width: number; height: number }> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const b = unionBounds(shapes) ?? { x: 0, y: 0, w: 400, h: 300 };
  const pad = 40;
  const width = Math.ceil(b.w + pad * 2);
  const height = Math.ceil(b.h + pad * 2);
  const body = renderToStaticMarkup(
    createElement(
      'g',
      { transform: `translate(${pad - b.x} ${pad - b.y})` },
      shapes.map((s) => createElement(ShapeView, { key: s.id, shape: s, exporting: true })),
    ),
  );
  const bg = /^#[0-9a-fA-F]{3,8}$/.test(background) ? background : '#ffffff';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${bg}"/>${body}</svg>`;
  return { svg, width, height };
}

export async function exportSvg(name: string, shapes: Shape[], background: string): Promise<void> {
  const { svg } = await boardToSvg(shapes, background);
  downloadBlob(`${name}.svg`, new Blob([svg], { type: 'image/svg+xml' }));
}

export async function exportPng(name: string, shapes: Shape[], background: string, scale = 2): Promise<void> {
  const { svg, width, height } = await boardToSvg(shapes, background);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('이미지를 만들 수 없습니다'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (blob) downloadBlob(`${name}.png`, blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 아트보드 하나를 그 크기 그대로 (밖으로 나간 부분은 잘라서) */
export async function frameToSvg(frame: Shape, all: Shape[]): Promise<{ svg: string; width: number; height: number }> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const b = boundsOf(frame);
  const width = Math.round(b.w);
  const height = Math.round(b.h);
  // 아트보드보다 위에 그려진 도형 중 겹치는 것
  const inside = all.filter((s) => s.id !== frame.id && s.z > frame.z && s.type !== 'frame' && intersects(boundsOf(s), b));
  const body = renderToStaticMarkup(
    createElement(
      'g',
      { transform: `translate(${-b.x} ${-b.y})` },
      inside.map((s) => createElement(ShapeView, { key: s.id, shape: s, exporting: true })),
    ),
  );
  const bg = /^#[0-9a-fA-F]{3,8}$/.test(frame.fill) ? frame.fill : '#ffffff';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><clipPath id="ab"><rect width="${width}" height="${height}"/></clipPath></defs><rect width="100%" height="100%" fill="${bg}"/><g clip-path="url(#ab)">${body}</g></svg>`;
  return { svg, width, height };
}

export async function exportFrame(frame: Shape, all: Shape[], format: 'svg' | 'png', scale = 2): Promise<void> {
  const { svg, width, height } = await frameToSvg(frame, all);
  const name = (frame.name || '아트보드').replace(/[\\/:*?"<>|]/g, '_');
  if (format === 'svg') return downloadBlob(`${name}.svg`, new Blob([svg], { type: 'image/svg+xml' }));
  await svgToPng(svg, width, height, scale, `${name}.png`);
}

async function svgToPng(svg: string, width: number, height: number, scale: number, filename: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('이미지를 만들 수 없습니다'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (blob) downloadBlob(filename, blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}
