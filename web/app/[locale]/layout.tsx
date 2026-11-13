import { notFound } from 'next/navigation';
import { supportedLanguages } from '@polaris/i18n/languages';
export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!(supportedLanguages as string[]).includes(locale)) notFound();
  return children;
}
