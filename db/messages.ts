import { supabase } from "@/lib/supabase/browser-client"
import { Tables, TablesInsert, TablesUpdate } from "@/supabase/types"

export const getMessageById = async (messageId: string) => {
  const { data: message } = await supabase
    .from("messages")
    .select("*")
    .eq("id", messageId)
    .single()

  if (!message) {
    throw new Error("Message not found")
  }

  return message
}

/** How many messages a chat opens on. Older ones load on request. */
export const CHAT_PAGE_SIZE = 100

export interface MessagePage {
  /** Oldest first, ready to render. */
  messages: MessageWithFileItems[]
  /** Whether anything sits before the first message returned. */
  hasOlder: boolean
}

export type MessageWithFileItems = Tables<"messages"> & {
  file_items: Tables<"file_items">[]
}

/**
 * A chat's most recent messages, with their retrieved file chunks.
 *
 * Three things this does that the previous version did not:
 *
 * - It embeds `file_items`. The caller used to fetch them one query per
 *   message, so opening a fifty-message chat cost fifty-one round trips before
 *   anything rendered.
 * - It orders explicitly. The rows were read with no ORDER BY and sorted only
 *   for display, so the copy handed to the model — and the one regeneration
 *   targets — was in whatever order Postgres happened to return. Editing a
 *   message updates the row, which can move it, and nothing would have said so.
 * - It stops at `limit`. A long chat used to send its entire history over the
 *   wire to render a screenful.
 *
 * `before` is a sequence number: pass the oldest one on screen to fetch the
 * page above it.
 */
export const getMessagesByChatId = async (
  chatId: string,
  { limit = CHAT_PAGE_SIZE, before }: { limit?: number; before?: number } = {}
): Promise<MessagePage> => {
  // Newest first so the limit takes the recent end, then reversed for display.
  let query = supabase
    .from("messages")
    .select("*, file_items(*)")
    .eq("chat_id", chatId)
    .order("sequence_number", { ascending: false })
    .limit(limit + 1)

  if (before !== undefined) {
    query = query.lt("sequence_number", before)
  }

  const { data, error } = await query

  if (!data) {
    throw new Error(error?.message ?? "Messages not found")
  }

  // The extra row is how we know there is more, without a second count query.
  const hasOlder = data.length > limit
  const page = hasOlder ? data.slice(0, limit) : data

  return {
    messages: page.reverse() as MessageWithFileItems[],
    hasOlder
  }
}

export const createMessage = async (message: TablesInsert<"messages">) => {
  const { data: createdMessage, error } = await supabase
    .from("messages")
    .insert([message])
    .select("*")
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return createdMessage
}

export const createMessages = async (messages: TablesInsert<"messages">[]) => {
  const { data: createdMessages, error } = await supabase
    .from("messages")
    .insert(messages)
    .select("*")

  if (error) {
    throw new Error(error.message)
  }

  return createdMessages
}

export const updateMessage = async (
  messageId: string,
  message: TablesUpdate<"messages">
) => {
  const { data: updatedMessage, error } = await supabase
    .from("messages")
    .update(message)
    .eq("id", messageId)
    .select("*")
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return updatedMessage
}

export const deleteMessage = async (messageId: string) => {
  const { error } = await supabase.from("messages").delete().eq("id", messageId)

  if (error) {
    throw new Error(error.message)
  }

  return true
}

export async function deleteMessagesIncludingAndAfter(
  userId: string,
  chatId: string,
  sequenceNumber: number
) {
  const { error } = await supabase.rpc("delete_messages_including_and_after", {
    p_user_id: userId,
    p_chat_id: chatId,
    p_sequence_number: sequenceNumber
  })

  if (error) {
    return {
      error: "Failed to delete messages."
    }
  }

  return true
}
