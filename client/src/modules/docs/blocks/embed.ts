/*
 * 임베드: 주소를 알려진 서비스의 '퍼가기' 주소로 바꾼다. 목록에 없는 주소는 임베드하지 않는다 (링크로 넣는다)
 */
export interface EmbedInfo {
  provider: string;
  /** iframe 주소 */
  src: string;
  /** 높이 (px) — 없으면 16:9 비율 */
  height?: number;
}

export const EMBED_PROVIDERS = 'YouTube · Vimeo · Loom · Figma · CodePen · Google 지도 · Spotify';

export function resolveEmbed(raw: string): EmbedInfo | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^www\.|^m\./, '');
  const path = url.pathname;
  const id = (re: RegExp) => re.exec(path)?.[1];

  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be' || host === 'music.youtube.com') {
    const v =
      host === 'youtu.be'
        ? id(/^\/([\w-]{6,})/)
        : url.searchParams.get('v') ?? id(/^\/(?:shorts|embed|live)\/([\w-]{6,})/);
    if (!v) return null;
    const t = Number.parseInt(url.searchParams.get('t') ?? url.searchParams.get('start') ?? '', 10);
    return { provider: 'YouTube', src: `https://www.youtube-nocookie.com/embed/${v}${Number.isFinite(t) && t > 0 ? `?start=${t}` : ''}` };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const v = id(/(\d{5,})/);
    return v ? { provider: 'Vimeo', src: `https://player.vimeo.com/video/${v}` } : null;
  }
  if (host === 'loom.com') {
    const v = id(/^\/(?:share|embed)\/([\w-]+)/);
    return v ? { provider: 'Loom', src: `https://www.loom.com/embed/${v}` } : null;
  }
  if (host === 'figma.com') {
    if (!/^\/(file|design|proto|board|slides)\//.test(path)) return null;
    return { provider: 'Figma', src: `https://www.figma.com/embed?embed_host=madang&url=${encodeURIComponent(url.toString())}`, height: 450 };
  }
  if (host === 'codepen.io') {
    const m = /^\/([\w-]+)\/(?:pen|full|details|embed)\/(\w+)/.exec(path);
    return m ? { provider: 'CodePen', src: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`, height: 420 } : null;
  }
  if ((host === 'google.com' || host === 'maps.google.com') && path.startsWith('/maps/embed')) {
    return { provider: 'Google 지도', src: url.toString(), height: 400 };
  }
  if (host === 'open.spotify.com') {
    const m = /^\/(?:embed\/)?(track|album|playlist|episode|show|artist)\/(\w+)/.exec(path);
    return m ? { provider: 'Spotify', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: m[1] === 'track' || m[1] === 'episode' ? 152 : 352 } : null;
  }
  return null;
}

/** 저장된 임베드 주소가 허용된 곳인지 (붙여 넣은 HTML 등으로 다른 주소가 들어오지 않게) */
export function isAllowedEmbedSrc(src: string | null | undefined): src is string {
  if (!src) return false;
  try {
    const u = new URL(src);
    return (
      u.protocol === 'https:' &&
      ['www.youtube-nocookie.com', 'player.vimeo.com', 'www.loom.com', 'www.figma.com', 'codepen.io', 'www.google.com', 'open.spotify.com'].includes(u.hostname)
    );
  } catch {
    return false;
  }
}
