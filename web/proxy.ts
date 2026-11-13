import { NextRequest } from 'next/server';
import { createProxy } from 'next-i18next/proxy';
import { matchLanguage, type Language } from '@polaris/i18n/languages';
import i18nConfig from './i18n.config';

const i18nProxy = createProxy(i18nConfig);

// next-i18next matches only exact codes or bare base languages, so zh-CN or zh-TW would fall back to English.
// Rewrite Accept-Language to the supported codes the shared matcher picks, keeping the visitor's order.
export function supportedAcceptLanguage(header: string) {
  const ranked = header.split(',').map((part, index) => {
    const [tag, ...parameters] = part.trim().split(';');
    const quality = Number(parameters.find(item => item.trim().startsWith('q='))?.trim().slice(2) ?? 1);
    return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0, index };
  }).filter(item => item.tag && item.quality > 0).sort((a, b) => b.quality - a.quality || a.index - b.index);
  const codes = [...new Set(ranked.map(item => matchLanguage(item.tag)).filter((code): code is Language => !!code))];
  return codes.map((code, index) => index ? `${code};q=${(1 - index / 10).toFixed(1)}` : code).join(',');
}

export function proxy(request: NextRequest) {
  const header = request.headers.get('accept-language');
  if (!header) return i18nProxy(request);
  const headers = new Headers(request.headers);
  headers.set('accept-language', supportedAcceptLanguage(header) || 'en');
  return i18nProxy(new NextRequest(request, { headers }));
}

export const config = { matcher: ['/((?!api(?:/|$)|_next|favicon.ico|.*\\..*).*)'] };
