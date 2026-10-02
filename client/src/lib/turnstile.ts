/*
 * 클라우드플레어 Turnstile(봇 확인) — 서버 설정에 사이트 키가 있을 때만 로그인 화면에서 불러온다.
 * 대부분은 보이지 않게 통과하고, 의심스러울 때만 확인 상자가 나타난다.
 */

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  execute(id: string): void;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function load(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('봇 확인을 불러오지 못했습니다.')));
    s.onerror = () => {
      loading = null;
      reject(new Error('봇 확인을 불러오지 못했습니다. 네트워크를 확인해 주세요.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export interface TurnstileWidget {
  /** 매번 새 토큰 (토큰은 한 번만 쓸 수 있다) */
  token(): Promise<string>;
  remove(): void;
}

export async function mountTurnstile(el: HTMLElement, siteKey: string): Promise<TurnstileWidget> {
  const api = await load();
  let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
  const settle = (fn: (p: NonNullable<typeof pending>) => void) => {
    const p = pending;
    pending = null;
    if (p) fn(p);
  };
  const id = api.render(el, {
    sitekey: siteKey,
    execution: 'execute',
    appearance: 'interaction-only',
    language: 'ko',
    callback: (t: string) => settle((p) => p.resolve(t)),
    'error-callback': () => settle((p) => p.reject(new Error('봇 확인에 실패했습니다. 다시 시도해 주세요.'))),
    'expired-callback': () => settle((p) => p.reject(new Error('봇 확인 시간이 지났습니다. 다시 시도해 주세요.'))),
  });
  return {
    token() {
      settle((p) => p.reject(new Error('봇 확인을 다시 시작합니다.')));
      return new Promise<string>((resolve, reject) => {
        pending = { resolve, reject };
        api.reset(id);
        api.execute(id);
      });
    },
    remove: () => api.remove(id),
  };
}
