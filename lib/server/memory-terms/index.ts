// The pure half of full-conversation retrieval: deciding whether the person
// asked for a transcript, and working out what to look for.
//
// Split out of get-full-conversation.ts, which was 724 lines with roughly 350
// of them literal data — forty trigger phrases, twenty-four month names and a
// two-hundred-entry bilingual stopword set — wrapped around the part that
// actually talks to the database. Nothing here touches Supabase, which is why
// all of it can be tested directly.

export { detectFullConversationIntent } from "./triggers"
export { extractDateRange, extractIsoDate, MONTHS } from "./dates"
export type { DateRange } from "./dates"
export { STOP } from "./stopwords"
export { extractQuotedPhrases, extractTopicWords } from "./terms"
