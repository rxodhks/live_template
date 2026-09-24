import { useUI, type InstallPromptEvent } from '../store/ui';

/**
 * 설치형 앱(PWA) 지원
 *  - 서비스 워커는 HTTPS(또는 localhost)에서만 동작하므로, 같은 Wi‑Fi의 http 주소로 열면 조용히 건너뛴다.
 *  - 개발 모드에서는 HMR을 방해하지 않도록 등록하지 않는다.
 */
export function setupPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    useUI.getState().setInstallPrompt(e as InstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => useUI.getState().setInstallPrompt(null));

  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('서비스 워커 등록 실패', err));
  });
}
