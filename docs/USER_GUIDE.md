# ChatMemo — User Guide

> **ChatMemo** is your personal AI memory layer. It captures conversations from Claude.ai and Claude Code, turns them into durable summaries, injects them into every new chat, and builds a self-improving knowledge base about you from daily interactions.

---

## Table of Contents

1. [What ChatMemo Does](#1-what-chatmemo-does)
2. [Starting a Chat](#2-starting-a-chat)
3. [Importing Conversations](#3-importing-conversations)
   - 3.1 [Claude.ai Bookmarklet (live sync)](#31-claudeai-bookmarklet-live-sync)
   - 3.2 [Claude Export (bulk import)](#32-claude-export-bulk-import)
   - 3.3 [ChatGPT Export (bulk import)](#33-chatgpt-export-bulk-import)
   - 3.4 [Claude Code Sessions](#34-claude-code-sessions)
4. [Memory History](#4-memory-history)
5. [Conversation Timeline](#5-conversation-timeline)
6. [Self-Improving Lessons](#6-self-improving-lessons)
7. [Choosing a Chat Model](#7-choosing-a-chat-model)
8. [Tips and Limitations](#8-tips-and-limitations)

---

## 1. What ChatMemo Does

ChatMemo builds a persistent, growing memory of who you are and what you work on. Every new chat starts with this context already loaded — no copy-pasting, no re-explaining.

**Two layers of memory are injected at session start:**

1. **User Lessons** — a structured knowledge document about you, automatically updated after each conversation. Contains your preferences, active projects, personal context, and recurring patterns. This is the highest-quality signal the AI reads first.

2. **Conversation History** — summaries and raw excerpts from your past conversations, including everything imported from Claude.ai and ChatGPT, with real conversation dates.

Together they give the AI up to ~48 000 characters of context about you before you type a single word.

Nothing is shared between users. All data is scoped to your account.

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

ChatGPT exports come as multiple `.json` files. You can import all of them at once.

**Export from ChatGPT:**
1. Go to ChatGPT → **Settings** → **Data Controls** → **Export data**.
2. Download the zip file and extract it.
3. You will find multiple files named `conversations-000.json`, `conversations-001.json`, etc.

**Import into ChatMemo:**
1. Open ChatMemo → Memory History → **ChatGPT** button.
2. Select **all** the `.json` files at once (Cmd+A in the file picker).
3. The button shows progress: **"Importing 3/13…"**
4. When done: **"✓ Imported N memory entries from M conversations"**

**What gets stored:**
- Every conversation is stored with its **real date** (from the ChatGPT export metadata), not the import date.
- Each conversation appears in the timeline with the correct `[YYYY-MM-DD]` header.
- No LLM processing is needed — import is fast (seconds, not minutes).
- Up to 100 MB per file is supported.

> If you previously imported files and got wrong dates, click **Clear all** in Memory History and reimport.

---

### 3.4 Claude Code Sessions

ChatMemo captures your Claude Code work sessions automatically — both from the **VS Code extension** (via Stop hook) and the **macOS desktop app** (via background daemon).

#### Bulk import of past sessions

Import all historical sessions at once (one-time, run after initial setup):

```bash
npm run import:claude
```

This scans `~/.claude/projects/` for all JSONL session files, skips ones already imported, summarises each via OpenRouter, and inserts them into Supabase. Progress is printed per session. Safe to interrupt and re-run — already-imported sessions are skipped.

#### Automatic sync (background daemon)

New sessions are synced automatically. The system uses two complementary mechanisms:

| Source | Mechanism |
|---|---|
| **VS Code** (Claude Code extension) | Stop hook fires after every turn, imports the session immediately |
| **macOS app** | Background daemon polls every 5 minutes, picks up sessions idle for 10+ minutes |

The daemon is managed by macOS **launchd** — it starts at login and runs indefinitely in the background. No manual action is needed after setup.

To check daemon status:
```bash
launchctl list | grep chatmemo
tail -f ~/.chatmemo/watch.log
```

---

## 4. Memory History

The **Memory History** panel shows all your stored summaries.

- Click the 🧠 (brain) icon in the left sidebar to open it.
- Summaries are listed newest first.
- Click the **trash** icon on any row to delete that summary.
- Click **Clear all** to wipe all memories (asks for confirmation).

> Deleting a summary is permanent. The AI will stop referencing the deleted context in future chats.

---

## 5. Conversation Timeline

The **Timeline** panel shows all your conversations — from Claude.ai, Claude Code, ChatGPT, and in-app chats — merged by date.

- Click the timeline icon (⏱) in the left sidebar to open it.
- Each entry shows the conversation date (real date, not import date), title, and source badge.
- **Search**: filter by keyword across titles and content.
- **Date range**: narrow to a specific time window using the from/to date pickers.
- **Source filter**: show only Claude.ai, ChatGPT, Claude Code, etc.
- Click the chevron (▼) on any entry to expand the full conversation excerpt.

---

## 6. Self-Improving Lessons

ChatMemo automatically builds and refines a **User Lessons** document from your daily conversations. You don't need to do anything — it runs in the background.

**How it works:**
1. After each chat (once you have 4+ messages), the in-app summariser fires automatically.
2. It saves a session summary, then runs a second pass comparing the summary against your current lessons document.
3. If new, meaningful facts were found (new project, preference, pattern), the lessons document is updated.
4. Outdated or contradicted entries are revised.

**What's in the lessons document:**

| Section | Examples |
|---|---|
| Preferences & Communication Style | Language preference, technical depth, response format |
| Active Projects & Work Context | Project names, tech stack, goals, role |
| Personal Context | Background, interests, stable personal facts |
| Recurring Patterns & Constraints | Hard requirements, known friction, things that repeat |

**To see your current lessons:** check the `user_lessons` table in your Supabase dashboard, or ask the AI directly — it reads the document at session start and can describe what it knows about you.

> The lessons document grows more accurate over time. Early sessions populate it from scratch; later sessions refine it with new facts and remove outdated ones.

---

## 7. Choosing a Chat Model

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
| Free tier | `meta-llama/llama-3.3-70b-instruct:free` |

> The model used for **summarising memories** is separate and configured by the admin. It defaults to `meta-llama/llama-3.3-70b-instruct:free`.

---

## 8. Tips and Limitations

**Tips:**
- Import conversations after a productive session, not during — the bookmarklet captures the full conversation at that moment.
- If the AI doesn't seem to know something you imported, start a **new chat**. Memory and lessons are injected at chat start.
- Use the Memory History panel to audit what the AI knows. Delete outdated or wrong summaries.
- Ask the AI directly what it knows: *"What do you know about my projects?"* or *"What was my first ChatGPT conversation?"*
- For ChatGPT imports, select all files at once — the importer processes them sequentially and shows per-file progress.

**Limitations:**
- The bookmarklet relies on CSS class names in claude.ai's HTML. If Anthropic redesigns the UI, the selectors may break until updated.
- Free OpenRouter models have rate limits. If you get an "OpenRouter rate limit" error, wait 60 seconds and try again.
- Memory context is capped at ~48 000 characters per chat. Very old conversation rows may be truncated if you have many; the lessons document and date-index rows are always prioritised.
- The lessons update (after each chat) adds one extra LLM call to the background summariser. If the OpenRouter key is missing or rate-limited, the lessons update is skipped silently — it never blocks the chat.
