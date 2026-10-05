import { formatDateValue } from './date-format.js';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Language, Translations, LOCALES, PluralForms } from './types';
import { en } from './en';
import { zh } from './zh';

interface LanguageContextType {
  language: Language;
  /** BCP-47 locale tag for the active language, for use with Intl APIs. */
  locale: string;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: Translations;
  /**
   * Locale-aware date formatting. Replaces per-component ad-hoc locale
   * ternaries (e.g. picking 'zh-CN' vs 'en-US' inline) with one Intl formatter
   * driven by the active locale.
   */
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
  /**
   * Interpolate `{token}` placeholders in a dictionary template, e.g.
   * `format(t.progress.zone2Summary, { hours: 12, pct: 68 })`.
   */
  format: (template: string, values: Record<string, string | number>) => string;
  /**
   * Locale-aware plural selection (ICU / Android `plurals` equivalent) followed
   * by `{count}` interpolation, e.g. `plural(n, t.periodProgress.calibrations)`.
   */
  plural: (count: number, forms: PluralForms) => string;
}

const dictionaries: Record<Language, Translations> = {
  en,
  zh
};

/** Replace `{token}` placeholders in a dictionary template. Unknown tokens are preserved. */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, token: string) =>
    Object.prototype.hasOwnProperty.call(values, token) ? String(values[token]) : match
  );
}

// Plural rules are locale-aware, matching ICU / Android `plurals` semantics:
// English distinguishes one/other, Chinese has a single `other` category.
const pluralRulesCache = new Map<string, Intl.PluralRules>();

function getPluralRules(locale: string): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  locale: LOCALES.en,
  setLanguage: () => {},
  toggleLanguage: () => {},
  t: en,
  formatDate: (value, options) => formatDateValue(value, LOCALES.en, options),
  format: interpolate,
  plural: (count, forms) =>
    interpolate(getPluralRules(LOCALES.en).select(count) === 'one' ? forms.one : forms.other, { count })
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem('aerolab_lang');
      if (stored === 'en') {
        return stored;
      }
      if (stored === 'zh') {
        // Reset and purge accidental Chinese selection back to English
        localStorage.removeItem('aerolab_lang');
      }
    } catch { /* best-effort cleanup: safe to ignore */ }
    return 'en';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem('aerolab_lang', lang);
    } catch { /* best-effort cleanup: safe to ignore */ }
  };

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'zh' : 'en');
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const formatDate = useCallback(
    (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => {
      return formatDateValue(value, LOCALES[language], options);
    },
    [language]
  );

  const format = useCallback(
    (template: string, values: Record<string, string | number>) => interpolate(template, values),
    []
  );

  const plural = useCallback(
    (count: number, forms: PluralForms) => {
      const category = getPluralRules(LOCALES[language]).select(count);
      return interpolate(category === 'one' ? forms.one : forms.other, { count });
    },
    [language]
  );

  const value: LanguageContextType = {
    language,
    locale: LOCALES[language],
    setLanguage,
    toggleLanguage,
    t: dictionaries[language],
    formatDate,
    format,
    plural
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useTranslation = () => useContext(LanguageContext);
export const useLanguage = () => useContext(LanguageContext);
