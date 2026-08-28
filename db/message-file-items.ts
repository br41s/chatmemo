import { supabase } from "@/lib/supabase/browser-client"
import { TablesInsert } from "@/supabase/types"

// `getMessageFileItemsByMessageId` used to live here. Its only caller ran it
// once per message while opening a chat; the messages query embeds
// `file_items` now, so there is nothing left to ask one row at a time.

export const createMessageFileItems = async (
  messageFileItems: TablesInsert<"message_file_items">[]
) => {
  const { data: createdMessageFileItems, error } = await supabase
    .from("message_file_items")
    .insert(messageFileItems)
    .select("*")

  if (!createdMessageFileItems) {
    throw new Error(error.message)
  }

  return createdMessageFileItems
}
