import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, useSession } from './store/session';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/modules.css';
import './styles/spaces.css';
import './styles/auth.css';

applyTheme(useSession.getState().theme);

// 예전 버전(PWA)에서 설치된 서비스 워커가 남아 있으면 정리
navigator.serviceWorker?.getRegistrations?.().then((regs) => regs.forEach((r) => void r.unregister())).catch(() => {});

createRoot(document.getElementById('root')!).render(<App />);
