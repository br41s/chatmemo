// The phrase list that turns full-conversation retrieval on.
//
// Retrieval is expensive — it reads whole transcripts — so it only runs when
// the person has clearly asked for one, in English or Spanish. Detection is
// pure string matching with no database call, which is what makes the feature
// free on every other question.
//
// The list is data, not logic, and it was three hundred lines of it sitting in
// the middle of the module that does the retrieval.

const TRIGGERS = [
  // English — conversation/chat variants
  "full conversation",
  "complete conversation",
  "entire conversation",
  "whole conversation",
  "original conversation",
  "full chat",
  "complete chat",
  "entire chat",
  "whole chat",
  "full thread",
  "all messages",
  "full transcript",
  "recover conversation",
  "recover the conversation",
  "recover chat",
  "recover the chat",
  "what did we say",
  "what did we discuss",
  "transcript",
  // Spanish
  "conversacion completa",
  "conversación completa",
  "conversacion entera",
  "conversación entera",
  "conversacion original",
  "conversación original",
  "chat completo",
  "chat entero",
  "transcripcion",
  "transcripción",
  "que hablamos",
  "qué hablamos",
  "que dijimos",
  "qué dijimos",
  "recupera la conversacion",
  "recupera la conversación",
  "recuperar la conversacion",
  "recuperar la conversación",
  "recupera el chat",
  "recuperar el chat",
  "recupera la primera",
  "recupera la ultima",
  "recupera la última",
  "dame la primera",
  "dame el chat",
  "dame la conversacion",
  "dame la conversación"
]

const TRIGGER_PATTERNS = [
  // English: verb ... conversation/chat/thread/transcript
  /\b(show|find|search|retrieve|get|recover|give|fetch|pull|read)\b.{0,40}\b(conversation|chat|thread|transcript)/,
  // English: full/complete/entire ... chat/conversation/thread
  /\b(full|complete|entire|whole|original)\b.{0,20}\b(chat|conversation|thread|transcript)/,
  // Spanish: verb ... conversación/chat
  /\b(recupera|recuperar|muestra|muestrame|muéstrame|busca|buscar|dame|ensename|enséñame|saca|trae)\b.{0,40}\b(conversaci[oó]n|chat)/,
  // Spanish: conversación/chat ... completa/entera/original
  /\b(conversaci[oó]n|chat)\b.{0,40}\b(completa|completo|entera|entero|original|integra|íntegra)/
]

export function detectFullConversationIntent(message: string): boolean {
  const lower = message.toLowerCase()
  if (TRIGGERS.some(t => lower.includes(t))) return true
  if (TRIGGER_PATTERNS.some(p => p.test(lower))) return true
  return false
}
