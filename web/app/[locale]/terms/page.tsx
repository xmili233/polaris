import { getT } from '../../../i18n';
import { Contact, operator, Updated } from '../../legal';
export default async function Page() {
  const { t, lng } = await getT();
  return <article className="wrap prose"><h1>{t('web.termsTitle')}</h1><Updated lng={lng} t={t} />
    <h2>{t('web.scopeTitle')}</h2><p>{t('web.scopeBody')}</p>
    <h2>{t('web.licenseTitle')}</h2><p>{t('web.licenseBody')}</p>
    <h2>{t('web.backupTitle')}</h2><p>{t('web.backupBody')}</p>
    <h2>{t('web.contactTitle')}</h2><Contact text={t('web.termsContact', { operator: operator.name, email: operator.email })} /></article>;
}
