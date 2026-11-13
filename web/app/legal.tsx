// Operator details for the privacy policy and terms (user, 2026-11-13).
// The address forwards through Cloudflare Email Routing, so the operator's own inbox stays private.
export const operator = { name: 'Zane', email: 'hello@polarisboards.com' };
const updated = new Date('2026-11-13T00:00:00Z');

export function Updated({ lng, t }: { lng: string; t: (key: string, options?: Record<string, string>) => string }) {
  const date = new Intl.DateTimeFormat(lng, { dateStyle: 'long', timeZone: 'UTC' }).format(updated);
  return <p className="notice"><time dateTime={updated.toISOString().slice(0, 10)}>{t('web.updated', { date })}</time></p>;
}

// Translations place the address anywhere in the sentence; split around it to make it a link.
export function Contact({ text }: { text: string }) {
  const [before, after = ''] = text.split(operator.email);
  return <p>{before}<a href={`mailto:${operator.email}`}>{operator.email}</a>{after}</p>;
}
