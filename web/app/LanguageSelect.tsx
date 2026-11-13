'use client';
import { usePathname } from 'next/navigation';
import { languages } from '@polaris/i18n/languages';
// The header and footer live in the root layout, which client-side navigation keeps mounted.
// A full page load re-renders them, and <html lang>, in the chosen language.
export function LanguageSelect({ language, label }: { language: string; label: string }) {
  const pathname = usePathname();
  return <select aria-label={label} value={language} onChange={event => {
    const parts = pathname.split('/');
    if (languages.some(item => item.code === parts[1])) parts[1] = event.target.value;
    else parts.splice(1, 0, event.target.value);
    window.location.assign(parts.join('/') + window.location.hash);
  }}>{languages.map(item => <option key={item.code} value={item.code} lang={item.code}>{item.name}</option>)}</select>;
}
