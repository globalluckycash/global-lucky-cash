import { useI18n } from 'vue-i18n'

export interface LocaleOption {
  code: string
  shortLabel: string
  label: string
}

export const LOCALE_OPTIONS: LocaleOption[] = [
  { code: 'en-US', shortLabel: 'EN', label: 'English' },
  { code: 'zh-TW', shortLabel: '繁中', label: '繁體中文' },
]

export function useLocaleSwitch() {
  const { locale } = useI18n()

  function setLocale(code: string) {
    locale.value = code
    localStorage.setItem('lang', code)
  }

  return { locale, localeOptions: LOCALE_OPTIONS, setLocale }
}
