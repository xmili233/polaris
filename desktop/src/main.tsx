import { createRoot } from 'react-dom/client';
import { LocaleProvider } from './LocaleProvider';
import { DesktopShell } from './DesktopShell';
import { applyColorScheme } from './color-scheme';
import './theme.css';
import './styles.css';

// The window starts in the appearance the main process chose; config confirms it once it arrives.
applyColorScheme(matchMedia('(prefers-color-scheme: dark)').matches);
createRoot(document.getElementById('root')!).render(<LocaleProvider><DesktopShell /></LocaleProvider>);
