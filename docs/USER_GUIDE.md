# ChatMemo — User Guide

> **ChatMemo** is your personal AI memory layer. It captures conversations from Claude.ai and Claude Code, turns them into durable summaries, and injects them into every new chat so the AI always knows your context.

---

## Table of Contents

1. [What ChatMemo Does](#1-what-chatmemo-does)
2. [Starting a Chat](#2-starting-a-chat)
3. [Importing Conversations](#3-importing-conversations)
   - 3.1 [Claude.ai Bookmarklet (live sync)](#31-claudeai-bookmarklet-live-sync)
   - 3.2 [Claude Export (bulk import)](#32-claude-export-bulk-import)
   - 3.3 [ChatGPT Export (bulk import)](#33-chatgpt-export-bulk-import)
4. [Memory History](#4-memory-history)
5. [Choosing a Chat Model](#5-choosing-a-chat-model)
6. [Tips and Limitations](#6-tips-and-limitations)

---

## 1. What ChatMemo Does

Every time you import or save a conversation, ChatMemo:

1. Sends the conversation to an LLM (via OpenRouter) to extract a **memory summary** — the durable facts, project context, and preferences worth remembering.
2. Stores the summary in your private Supabase database.
3. Prepends the most recent summaries (up to ~24 000 characters) to the **system prompt** of every new chat, so the AI already knows who you are and what you are working on.

Nothing is shared between users. All summaries are scoped to your account.

---

## 2. Starting a Chat

1. Open ChatMemo in your browser (`http://localhost:3000` for local installs).
2. Select a workspace from the left sidebar (or use the default one).
3. Click **New Chat** (pencil icon at the top of the sidebar).
4. Choose a model from the model selector in the chat header.
5. Start typing. The AI will already have your memory context.

> **Important:** memory is injected at chat *start*. If you import a new conversation while a chat is already open, open a **new chat** to pick up the update.

---

## 3. Importing Conversations

### 3.1 Claude.ai Bookmarklet (live sync)

The bookmarklet saves any open claude.ai conversation to ChatMemo with one click. It does **not** require ChatMemo to be open in another tab.

**First-time setup** (done once by the admin — see Admin Guide):
- Run `npm run setup:sync` in the ChatMemo project folder.
- Copy the bookmarklet URL printed at the end.
- In your browser, show the bookmarks bar (**⌘ Shift B** on Mac).
- Right-click the bar → **Add page…** → paste the URL → name it **Save to ChatMemo**.

**Daily use:**
1. Open any conversation on [claude.ai](https://claude.ai).
2. Click the **Save to ChatMemo** bookmark.
3. Wait 2–5 seconds for the AI to summarise the conversation.
4. A toast notification appears:
   - 🟢 **"✓ Saved to ChatMemo (N msgs)"** — success.
   - 🟡 **"ℹ Nothing new to save"** — conversation too short or nothing memorable.
   - 🔴 **"✗ ChatMemo error: …"** — something went wrong (see error text).

**Requirements:**
- ChatMemo must be running locally at `http://localhost:3000`.
- The conversation must have at least one Claude reply and be longer than ~200 characters total.

---

### 3.2 Claude Export (bulk import)

Import your entire Claude conversation history in one go.

**Export from Claude:**
1. Go to [claude.ai](https://claude.ai) → **Settings** → **Privacy** → **Export data**.
2. Wait for the email with the download link.
3. Download and unzip the file. You will find a `conversations.json` file.

**Import into ChatMemo:**
1. Open ChatMemo → click the **Import** icon in the left sidebar.
2. Choose **Claude export**.
3. Select the `conversations.json` file.
4. Click **Import**. ChatMemo will:
   - Store full conversation text for substantive conversations.
   - Generate LLM summaries in batches of 3 conversations.
   - Add a date index row for quick date-based recall.
5. The import may take several minutes depending on the number of conversations.

---

### 3.3 ChatGPT Export (bulk import)

**Export from ChatGPT:**
1. Go to ChatGPT → **Settings** → **Data Controls** → **Export data**.
2. Download the zip file and extract it.
3. Find the `conversations.json` file inside.

**Import into ChatMemo:**
1. Open ChatMemo → **Import** → **ChatGPT export**.
2. Select the `conversations.json` file and click **Import**.

---

## 4. Memory History

The **Memory History** panel shows all your stored summaries.

- Click the 🧠 (brain) icon in the left sidebar to open it.
- Summaries are listed newest first.
- Click the **trash** icon on any row to delete that summary.
- Click **Clear all** to wipe all memories (asks for confirmation).

> Deleting a summary is permanent. The AI will stop referencing the deleted context in future chats.

---

## 5. Choosing a Chat Model

ChatMemo supports any model available through OpenRouter or directly via provider APIs.

- Click the model name in the chat header to open the model selector.
- Your selection persists across page reloads.
- OpenRouter models appear as `provider/model-name` (e.g. `openai/gpt-4o`).

**Recommended models for chat:**
| Use case | Model |
|---|---|
| General use | `openai/gpt-4o` |
| Fast / cheap | `openai/gpt-4o-mini` |
| Reasoning | `anthropic/claude-3-5-sonnet` |
| Free tier | `openai/gpt-oss-120b:free` |

> The model used for **summarising memories** is separate and configured by the admin. It defaults to `openai/gpt-oss-120b:free`.

---

## 6. Tips and Limitations

**Tips:**
- Import conversations after a productive session, not during — the bookmarklet captures the full conversation at that moment.
- If the AI doesn't seem to know something you imported, start a **new chat**. Memory loads on chat start.
- Use the Memory History panel to audit what the AI knows. Delete outdated or wrong summaries.

**Limitations:**
- The bookmarklet relies on CSS class names in claude.ai's HTML. If Anthropic redesigns the UI, the selectors may break until updated.
- Free OpenRouter models have rate limits. If you get an "OpenRouter rate limit" error, wait 60 seconds and try again.
- Memory summaries are capped at ~24 000 characters per chat. Very old summaries may be truncated if you have many.
- ChatGPT and Claude imports may take 5–15 minutes for large export files (hundreds of conversations).
