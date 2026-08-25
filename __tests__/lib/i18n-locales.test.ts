import { readdirSync, readFileSync } from "fs"
import { join } from "path"

const i18nConfig = require("../../i18nConfig")

const LOCALES_DIR = join(__dirname, "..", "..", "public", "locales")

function translationKeys(locale: string): string[] {
  const raw = readFileSync(
    join(LOCALES_DIR, locale, "translation.json"),
    "utf8"
  )

  return Object.keys(JSON.parse(raw)).sort()
}

describe("i18n locales", () => {
  it("declares exactly the locales that have translation files", () => {
    // The drift this catches: eighteen locales were declared and two existed,
    // so sixteen of them added a locale segment to the URL and a middleware
    // redirect in exchange for the raw English key.
    const onDisk = readdirSync(LOCALES_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()

    expect([...i18nConfig.locales].sort()).toEqual(onDisk)
  })

  it("includes the default locale", () => {
    expect(i18nConfig.locales).toContain(i18nConfig.defaultLocale)
  })

  it("translates the same keys in every locale", () => {
    // A key present in one file and missing in another falls back to the key
    // itself, which renders as English inside an otherwise translated screen.
    const reference = translationKeys(i18nConfig.defaultLocale)

    expect(reference.length).toBeGreaterThan(0)

    for (const locale of i18nConfig.locales) {
      expect([locale, translationKeys(locale)]).toEqual([locale, reference])
    }
  })

  it("leaves no key untranslated outside the default locale", () => {
    // A value identical to its key is an untranslated string wearing a
    // translation's clothes.
    for (const locale of i18nConfig.locales) {
      if (locale === i18nConfig.defaultLocale) continue

      const raw = readFileSync(
        join(LOCALES_DIR, locale, "translation.json"),
        "utf8"
      )
      const untranslated = Object.entries(JSON.parse(raw))
        .filter(([key, value]) => key === value)
        .map(([key]) => key)

      expect([locale, untranslated]).toEqual([locale, []])
    }
  })
})
