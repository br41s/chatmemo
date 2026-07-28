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
   - 3.5 [Perplexity Export (bulk import)](#35-perplexity-export-bulk-import)
4. [Memory History](#4-memory-history)
   - 4.1 [Backup & Restore](#41-backup--restore)
5. [Conversation Timeline](#5-conversation-timeline)
6. [Self-Improving Lessons](#6-self-improving-lessons)
7. [Choosing a Chat Model](#7-choosing-a-chat-model)
8. [Tools (API Plugins)](#8-tools-api-plugins)
9. [Tips and Limitations](#9-tips-and-limitations)

---

## 1. What ChatMemo Does

ChatMemo builds a persistent, growing memory of who you are and what you work on. Every new chat starts with this context already loaded — no copy-pasting, no re-explaining.

**Two layers of memory are injected at session start:**

1. **User Lessons** — a structured knowledge document about you, automatically updated after each conversation. Contains your preferences, active projects, personal context, and recurring patterns. This is the highest-quality signal the AI reads first.

2. **Conversation History** — summaries and raw excerpts from your past conversations, including everything imported from Claude.ai and ChatGPT, with real conversation dates.

Together they give the AI up to ~48 000 characters of context about you before you type a single word.

**Recovering a full conversation on demand:** the two layers above are *summaries* — compact by design. When you explicitly ask to recover a **full conversation** (in English or Spanish — e.g. *"recover the full conversation about X"*, *"recupera la conversación completa de …"*, or by date *"recupera la conversación del 2026-03-31"*), ChatMemo pulls the **complete, untruncated transcript** instead of the summary. It works best when you quote the conversation title or give a specific date. Recoverable in full: in-app chats, **Perplexity** imports, and **Claude** imports. ChatGPT imports are stored compressed, so they cannot be recovered word-for-word.

Chats, memories, profiles, and private resources are scoped to your account. Only resources you explicitly mark as public or unlisted can be read by another user, and ChatMemo blocks shared models or tools that contain stored credentials.

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

### 3.5 Perplexity Export (bulk import)

Import your full Perplexity conversation history including COPILOT, DEFAULT, and REASONING mode sessions.

**Export from Perplexity:**
1. Go to [perplexity.ai](https://perplexity.ai) → **Settings** → **Account** → **Export data**.
2. Download and extract the zip file. You will find a `conversations-*.json` file.

**Import into ChatMemo:**
1. Open ChatMemo → Memory History → **Perplexity** button.
2. Select one or more `conversations-*.json` files (multi-file supported).
3. When done: **"✓ Imported N memory entries from M conversations"**

**What gets stored:**
- Every conversation is stored with its **real date** from the export (derived from entry timestamps).
- The Perplexity **mode** (COPILOT, DEFAULT, REASONING, etc.) is stored alongside each conversation for context.
- A date index is inserted for fast date-based recall.
- Import is fast — no LLM processing required.
- Up to 100 MB per file supported.

**Incremental import:**
After the first import, subsequent imports of the same or updated export files automatically skip conversations already imported (based on a watermark of the most recent timestamp). Only new conversations are added.

---

## 4. Memory History

The **Memory History** panel shows all your stored summaries.

- Click the 🧠 (brain) icon in the left sidebar to open it.
- Summaries are listed newest first.
- Click the **trash** icon on any row to delete that summary.
- Click **Clear all** to wipe all memories (asks for confirmation).

**Selective source clear:**
At the bottom of the panel, under *Clear imported data by source*, there are three buttons — **✕ ChatGPT**, **✕ Claude**, **✕ Perplexity** — that delete only the data imported from that source and reset its watermark. Two-click confirmation required. Use this when you want to fix a bad import without losing data from other sources.

> Deleting a summary is permanent. The AI will stop referencing the deleted context in future chats.

### 4.1 Backup & Restore

**Why back up:** your conversation history is stored in Supabase. If you accidentally clear a source, need to migrate to a new account, or want an offline copy, the in-app export covers you.

#### Exporting all data

1. Open the Memory History panel.
2. Scroll to the bottom — **Backup & Restore** section.
3. Click **Export all**.
4. The browser downloads one JSON file per source that has data:
   - `chatmemo-backup-claude-YYYY-MM-DD.json` — Claude Code sessions, bookmarklet imports, legacy bulk imports
   - `chatmemo-backup-chatgpt-YYYY-MM-DD.json` — ChatGPT bulk imports
   - `chatmemo-backup-perplexity-YYYY-MM-DD.json` — Perplexity bulk imports
   - `chatmemo-backup-other-YYYY-MM-DD.json` — VS Code sync-hook entries and in-app chat summaries

Store these files somewhere safe (iCloud, external drive, etc.). **Repeat periodically** — monthly at minimum, weekly if you import frequently.

#### Restoring from a backup

1. Open the Memory History panel → Backup & Restore.
2. Click **Restore backup**.
3. Select **one backup file** (e.g. `chatmemo-backup-claude-2026-05-28.json`).
4. Repeat for each file you want to restore.

The restore is safe to run at any time — rows that already exist in the database are silently skipped. You will see a confirmation like `Restored 412 rows (0 skipped)` or `Restored 0 rows (412 already existed, skipped)`.

#### When to use restore

| Situation | Action |
|---|---|
| Accidentally clicked **✕ Claude** / **Clear all** | Restore the matching backup file |
| Moving to a new Supabase project | Export on old → Restore on new |
| Corrupted or missing data after an upgrade | Restore the most recent backup |
| Just want to verify backup integrity | Restore (duplicates are skipped, no harm done) |

> **Note:** the backup covers only the `summaries` table (conversation memory). Profiles, chat sessions, and messages are not included.

---

## 5. Conversation Timeline

The **Timeline** panel shows all your conversations — from Claude.ai, Claude Code, ChatGPT, Perplexity, and in-app chats — merged by date.

- Click the timeline icon (⏱) in the left sidebar to open it.
- Each entry shows the conversation date (real date, not import date), title, and source badge.
- **Search**: filter by keyword across titles and content.
- **Date range**: narrow to a specific time window using the from/to date pickers.
- **Source filter**: show only Claude.ai, ChatGPT, Claude Code, Perplexity, etc.

**Reading a conversation:**
- Click any entry to open it in the detail panel.
- **Desktop**: the detail panel opens to the right — the list stays visible so you can navigate without going back.
- **Mobile**: the detail replaces the list; tap ← to return.
- The selected entry is shown with the one before and the one after for context.
- Use **Load N more above / below** buttons to progressively reveal more adjacent conversations.
- Changing any filter closes the detail and returns to the list.

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

ChatMemo supports hosted provider models, OpenRouter, remote OpenAI-compatible models, and local Ollama models running on your Mac.

- Click the model name in the chat header to open the model selector.
- Your selection persists across page reloads.
- Use **Hosted** for provider and custom remote models, **Local** for Ollama, and **OpenRouter** for its catalogue.
- OpenRouter models appear as `provider/model-name` (e.g. `openai/gpt-4o`).

**Recommended models for chat:**
| Use case | Model |
|---|---|
| General use | `openai/gpt-4o` |
| Fast / cheap | `openai/gpt-4o-mini` |
| Reasoning | `anthropic/claude-3-5-sonnet` |
| Free tier | `meta-llama/llama-3.3-70b-instruct:free` |

> The model used for **summarising memories** is separate and configured by the admin. It defaults to `meta-llama/llama-3.3-70b-instruct:free`.

### Using a model locally on macOS

1. Install [Ollama](https://ollama.com/download).
2. Download a model, for example: `ollama pull llama3.2:3b`.
3. Confirm it appears in `ollama list`.
4. Ask the ChatMemo administrator to set `NEXT_PUBLIC_OLLAMA_URL=http://localhost:11434` and restart the app.
5. Open the model selector, choose **Local**, and select the downloaded model.

Inference requests and responses travel directly between your browser and Ollama on the Mac. They do not pass through the ChatMemo server and require no API key. ChatMemo still saves the conversation and generated memories to Supabase as normal. This works best when ChatMemo itself is opened at `http://localhost:3000`; the production server cannot reach a model on your Mac through `localhost`.

The sidebar **Models** section is different: it registers remote APIs compatible with OpenAI. Those endpoints must use public HTTPS. Models with an API key remain private; only keyless model definitions can be shared.

---

## 8. Tools (API Plugins)

The **Tools** section (⚡ bolt icon in the left sidebar) lets you register external APIs as callable functions. When an assistant has tools attached, it can decide mid-conversation to call one and use the result in its reply.

**How to add a tool:**
1. Click the ⚡ icon in the left sidebar → **New Tool**.
2. Give it a name and paste its OpenAPI schema (JSON).
3. Optionally add custom HTTP headers (e.g. `{"Authorization": "Bearer <token>"}`).
4. Attach the tool to an **Assistant** — tools are not active in plain chats.

> **Provider limitation:** Tools only work with **OpenAI** and **OpenRouter** models. If you select a tool while using an Anthropic, Google, Groq, or Mistral model directly, you will see an error and the chat will proceed without tool calls. Switch to an OpenAI or OpenRouter model to use tools.

**Sharing safely:** custom headers can contain credentials for a private tool, but a shared tool must have empty headers and credential-free public configuration. Keep a tool private when its URL contains query parameters, a webhook secret, or embedded credentials, or when its OpenAPI schema declares authentication/cookie/secret parameters. ChatMemo enforces the same rule in the execution route and in Supabase RLS.

---

## 9. Tips and Limitations

**Tips:**
- Import conversations after a productive session, not during — the bookmarklet captures the full conversation at that moment.
- If the AI doesn't seem to know something you imported, start a **new chat**. Memory and lessons are injected at chat start.
- Use the Memory History panel to audit what the AI knows. Delete outdated or wrong summaries.
- Ask the AI directly what it knows: *"What do you know about my projects?"* or *"What was my first ChatGPT conversation?"*
- To pull a full past conversation verbatim, say *"recover the full conversation"* (or *"recupera la conversación completa"*) and **quote the title or give the date** — e.g. *"recupera la conversación del 2026-03-31"*. A specific date is the most reliable signal.
- For ChatGPT imports, select all files at once — the importer processes them sequentially and shows per-file progress.

**Limitations:**
- The bookmarklet relies on CSS class names in claude.ai's HTML. If Anthropic redesigns the UI, the selectors may break until updated.
- Free OpenRouter models have rate limits. If you get an "OpenRouter rate limit" error, wait 60 seconds and try again.
- Memory context is capped at ~48 000 characters per chat. Very old conversation rows may be truncated if you have many; the lessons document and date-index rows are always prioritised.
- The lessons update (after each chat) adds one extra LLM call to the background summariser. If the OpenRouter key is missing or rate-limited, the lessons update is skipped silently — it never blocks the chat.
- Full-conversation recall works on the **OpenRouter** chat route. **ChatGPT** imports cannot be recovered word-for-word (they are stored compressed at import time); Perplexity, Claude, and in-app chats can. Title matching is exact and accent-sensitive — quote the title as it appears, or use a date.
- Ollama models appear only while the configured local endpoint is reachable from your browser. Restart ChatMemo after changing `NEXT_PUBLIC_OLLAMA_URL`, and do not expose Ollama's port `11434` to the internet.
- Tools are not currently available with Ollama models; use an OpenAI or OpenRouter model when a chat needs API tools.
