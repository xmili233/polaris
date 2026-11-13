import type { Metadata } from 'next';
import { getT } from '../i18n';
import { LanguageSelect } from './LanguageSelect';
import { links } from './links';
import '../../desktop/src/theme.css';
import './theme.css';
import './style.css';
import './mock.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: 'Polaris', description: t('web.hero.body') };
}

function Mark() {
  return <span className="mark" aria-hidden="true"><img src="/icon.svg" alt="" width="14" height="14" /></span>;
}

export default async function Layout({ children }: { children: React.ReactNode }) {
  const { t, lng } = await getT();
  // theme-dark selects the desktop's dark tokens, so product views show the app in its dark appearance.
  return <html lang={lng}><body className="theme-dark">
    <header className="site-header"><div className="wrap">
      <a className="brand" href={`/${lng}`}><Mark />Polaris</a>
      <nav>
        <a href={links.guide}>{t('web.nav.guide')}</a>
        <LanguageSelect language={lng} label={t('settings.language')} />
        <a className="button small" href={links.repository}>GitHub</a>
      </nav>
    </div></header>
    <main>{children}</main>
    <footer className="site-footer"><div className="wrap">
      <a className="brand" href={`/${lng}`}><Mark />Polaris</a>
      <nav>
        <a href={links.repository}>GitHub</a>
        <a href={links.guide}>{t('web.nav.guide')}</a>
        <a href={`/${lng}/privacy`}>{t('web.privacyTitle')}</a>
        <a href={`/${lng}/terms`}>{t('web.termsTitle')}</a>
        <a href={links.license}>AGPL-3.0</a>
      </nav>
    </div></footer>
  </body></html>;
}
