import { createServerI18next } from 'next-i18next/server';
import config from './i18n.config';
export const { getT } = createServerI18next(config);
