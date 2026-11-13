import { getT } from '../../../i18n';
export default async function Page() {
  const { t } = await getT();
  return <article className="wrap prose"><h1>{t('web.privacyTitle')}</h1><p className="notice">{t('web.previewPrivacy')}</p>
    <h2>{t('web.localTitle')}</h2><p>{t('web.localBody')}</p>
    <h2>{t('web.agentTitle')}</h2><p>{t('web.agentBody')}</p>
    <h2>{t('web.choicesTitle')}</h2><p>{t('web.choicesBody')}</p></article>;
}
