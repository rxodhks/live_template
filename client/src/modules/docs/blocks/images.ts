/*
 * 문서에 넣는 이미지 — 파일을 줄여 문서 안에 함께 저장한다 (별도 저장소 없이 개인 · 협업 공간 모두 같은 방식)
 *  - 긴 변 1600px, 450KB 안팎으로 줄인다 (작은 PNG 캡처는 선명하게 그대로)
 *  - 움직이는 GIF · SVG는 그대로 (900KB까지)
 */
const MAX_SIDE = 1600;
const TARGET_BYTES = 450_000;
const HARD_MAX_BYTES = 900_000;

export interface PreparedImage {
  src: string;
  width: number;
  height: number;
}

const readDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('파일을 읽지 못했습니다'));
    r.readAsDataURL(blob);
  });

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

const kb = (n: number) => `${Math.round(n / 1024)}KB`;

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일이 아닙니다.');
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
    if (file.size > HARD_MAX_BYTES) throw new Error(`${file.type === 'image/gif' ? 'GIF' : 'SVG'} 파일은 ${kb(HARD_MAX_BYTES)}까지 넣을 수 있습니다. (지금 ${kb(file.size)})`);
    const src = await readDataUrl(file);
    const size = await naturalSize(src).catch(() => ({ width: 0, height: 0 }));
    return { src, ...size };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('이 이미지 형식은 열 수 없습니다. PNG · JPG · WebP · GIF로 바꿔 보세요.');
  }
  const { width: w0, height: h0 } = bitmap;
  // 작고 이미 충분히 가벼운 이미지는 다시 압축하지 않는다 (글자가 있는 캡처가 흐려지지 않게)
  if (file.size <= TARGET_BYTES && Math.max(w0, h0) <= MAX_SIDE && /^image\/(png|jpeg|webp)$/.test(file.type)) {
    bitmap.close();
    return { src: await readDataUrl(file), width: w0, height: h0 };
  }
  let scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  for (let attempt = 0; attempt < 3; attempt++) {
    const width = Math.max(1, Math.round(w0 * scale));
    const height = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    let blob: Blob | null = null;
    for (const q of [0.86, 0.78, 0.68, 0.56]) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      blob = await toBlob(canvas, 'image/webp', q);
      // WebP로 저장하지 못하는 브라우저(사파리 등)는 JPEG로 — 투명한 부분은 흰색으로
      if (!blob || blob.type !== 'image/webp') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(bitmap, 0, 0, width, height);
        blob = await toBlob(canvas, 'image/jpeg', q);
      }
      if (blob && blob.size <= TARGET_BYTES) break;
    }
    if (blob && blob.size <= HARD_MAX_BYTES) {
      bitmap.close();
      return { src: await readDataUrl(blob), width, height };
    }
    scale *= 0.7;
  }
  bitmap.close();
  throw new Error('이미지가 너무 커서 줄이지 못했습니다. 더 작은 이미지를 넣어 주세요.');
}

function naturalSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = src;
  });
}

/** 문서에 넣어도 되는 이미지 주소 (외부 주소 또는 줄여서 넣은 이미지) */
export function isSafeImageSrc(src: string | null | undefined): src is string {
  if (!src) return false;
  if (/^https?:\/\//i.test(src)) return src.length < 4000;
  return /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/i.test(src) && src.length <= Math.ceil((HARD_MAX_BYTES * 4) / 3) + 100;
}
