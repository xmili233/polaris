import { getT } from '../../../i18n';
export default async function Page() {
  const { t } = await getT();
  return <article className="wrap prose"><h1>{t('web.termsTitle')}</h1><p className="notice">{t('web.previewTerms')}</p>
    <h2>{t('web.scopeTitle')}</h2><p>{t('web.scopeBody')}</p>
    <h2>{t('web.backupTitle')}</h2><p>{t('web.backupBody')}</p></article>;
}
