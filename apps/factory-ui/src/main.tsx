import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, getPreferences, i18n } from './i18n';
import './styles/index.css';

applyTheme(getPreferences().theme);
const updateLanguage = () => { document.documentElement.lang = i18n.locale; };
updateLanguage();
i18n.subscribe(updateLanguage);
createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><App /></StrictMode>);
