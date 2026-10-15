import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, useSession } from './store/session';
import { installErrorReporting } from './lib/errorReport';
import { installStaleBuildRecovery } from './lib/staleBuild';
import { AppErrorBoundary } from './pages/OutageScreen';
import { ready } from './i18n';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/modules.css';
import './styles/spaces.css';
import './styles/auth.css';
import './styles/docblocks.css';
import './styles/docpage.css';

installErrorReporting();
installStaleBuildRecovery();
applyTheme(useSession.getState().theme);

// 예전 버전(PWA)에서 설치된 서비스 워커가 남아 있으면 정리
navigator.serviceWorker?.getRegistrations?.().then((regs) => regs.forEach((r) => void r.unregister())).catch(() => {});

// 영어 화면은 영어 사전이 온 뒤에 그린다 (한국어 화면은 바로)
void ready.then(() =>
  createRoot(document.getElementById('root')!).render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>,
  ),
);
