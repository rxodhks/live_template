import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, useSession } from './store/session';
import { setupPwa } from './lib/pwa';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/modules.css';
import './styles/mobile.css';

applyTheme(useSession.getState().theme);
setupPwa();

createRoot(document.getElementById('root')!).render(<App />);
