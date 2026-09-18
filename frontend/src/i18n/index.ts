import { createI18n } from 'vue-i18n'
import zhTW from './zh-TW'
import enUS from './en-US'

// 舊版只有單一 'en' 語系，沿用其 localStorage 存值視為 'en-US'
const storedLang = localStorage.getItem('lang')

export const i18n = createI18n({
  legacy: false,
  locale: storedLang === 'en' ? 'en-US' : storedLang || 'en-US',
  fallbackLocale: 'en-US',
  messages: { 'zh-TW': zhTW, 'en-US': enUS },
})
