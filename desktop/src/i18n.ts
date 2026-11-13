export { translator, type Language, type LanguagePreference, type MessageKey } from '@polaris/i18n';
import { translator, type Language } from '@polaris/i18n';
export function decisionCount(count: number, language: Language) {
  return translator(language)('board.decisionCount', { count });
}
