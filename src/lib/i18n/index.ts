/**
 * Minimal localization layer.
 *
 * V1 ships Thai only, but every UI string goes through `t()` and every
 * locale-sensitive format reads `APP_LOCALE`, so adding a language later means:
 *   1. add `messages/<lang>.ts` satisfying `Messages`,
 *   2. make `currentLocale` switchable (settings + provider).
 */
import { th, type Messages } from './messages/th'

export type { Messages }
export type MessageKey = keyof Messages

/**
 * BCP-47 locale for Intl formatting.
 * `-u-ca-gregory` forces the Gregorian calendar: plain "th-TH" defaults to the
 * Buddhist calendar (year 2569 instead of 2026) in Intl.DateTimeFormat.
 */
export const APP_LOCALE = 'th-TH-u-ca-gregory'
export const APP_LANGUAGE = 'th'

const catalogs = { th } satisfies Record<string, Messages>

const currentMessages: Messages = catalogs[APP_LANGUAGE]

/** Look up a UI string. `{name}` placeholders are replaced from `params`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = currentMessages[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}
