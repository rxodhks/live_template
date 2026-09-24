import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, useSession } from './store/session';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/modules.css';

applyTheme(useSession.getState().theme);

createRoot(document.getElementById('root')!).render(<App />);
