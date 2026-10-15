/*
 * 서버가 보내는 글(메일 · 초대 미리보기)의 언어
 * 화면에서 보낸 요청은 x-lang 머리글(client/src/lib/api.ts)을, 그 밖에는 브라우저의 Accept-Language를 따른다.
 * API 오류 문구는 한국어 그대로 보내고 화면이 영어로 옮긴다 (client/src/i18n translateServer).
 */
export type Lang = 'ko' | 'en';

export function requestLang(req: Request): Lang {
  const chosen = req.headers.get('x-lang');
  if (chosen === 'ko' || chosen === 'en') return chosen;
  // 첫 번째로 고른 언어 — 머리글이 없거나 '*'뿐이면(링크 미리보기 봇 등) 한국어
  const first = req.headers.get('accept-language')?.split(',')[0]?.trim() ?? '';
  return /^[a-z]{2,3}\b/i.test(first) && !/^ko\b/i.test(first) ? 'en' : 'ko';
}
