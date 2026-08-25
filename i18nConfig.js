// Only the locales that actually have a translation file.
//
// This declared eighteen. Two had files, one of which held a single string
// keyed on text the composer no longer renders — so every locale but `en`
// resolved to the raw English key, sixteen of them after a middleware redirect
// and a locale segment added to the URL for nothing. `es` was among the
// missing, on a product whose memory prompts and decision log are both
// bilingual.
//
// __tests__/lib/i18n-locales.test.ts keeps this list and public/locales/ in
// agreement, which is the drift that produced the original state.
const i18nConfig = {
  defaultLocale: "en",
  locales: ["en", "de", "es"]
}

module.exports = i18nConfig
