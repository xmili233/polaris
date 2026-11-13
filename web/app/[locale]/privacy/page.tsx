import { getT } from '../../../i18n';
import { Contact, operator, Updated } from '../../legal';
export default async function Page() {
  const { t, lng } = await getT();
  return <article className="wrap prose"><h1>{t('web.privacyTitle')}</h1><Updated lng={lng} t={t} />
    <h2>{t('web.localTitle')}</h2><p>{t('web.localBody')}</p>
    <h2>{t('web.agentTitle')}</h2><p>{t('web.agentBody')}</p>
    <h2>{t('web.siteTitle')}</h2><p>{t('web.siteBody')}</p>
    <h2>{t('web.choicesTitle')}</h2><p>{t('web.choicesBody')}</p>
    <h2>{t('web.contactTitle')}</h2><Contact text={t('web.privacyContact', { operator: operator.name, email: operator.email })} /></article>;
}
