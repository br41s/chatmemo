#!/usr/bin/env node
/**
 * ChatMemo sync setup — run once from the chatmemo project root:
 *
 *   npm run setup:sync
 *
 * What it does:
 *  1. Reads credentials from .env.local
 *  2. Gets your Supabase user ID (first registered user via service role)
 *  3. Writes ~/.chatmemo/config.json (used by the hook script)
 *  4. Registers the Stop hook in ~/.claude/settings.json
 *  5. Prints the bookmarklet URL — drag it to your bookmarks bar
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join, resolve } from "path"

const CONFIG_DIR = join(homedir(), ".chatmemo")
const CONFIG_FILE = join(CONFIG_DIR, "config.json")
const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json")
const HOOK_SCRIPT = resolve("scripts/sync-to-chatmemo.mjs")
const CHATMEMO_URL = "http://localhost:3000"

// ---------------------------------------------------------------------------
// 1. Read .env.local
// ---------------------------------------------------------------------------

const envPath = resolve(".env.local")
if (!existsSync(envPath)) {
  console.error("✗ .env.local not found. Run this script from the chatmemo project root.")
  process.exit(1)
}

function readEnv(file) {
  const env = {}
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([^#=\s]+)\s*=\s*(.*)$/)
    if (match) env[match[1]] = match[2].trim()
  }
  return env
}

const env = readEnv(envPath)
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
const openrouterKey = env.OPENROUTER_API_KEY

if (!supabaseUrl || !serviceRoleKey || serviceRoleKey === "your-service-role-key") {
  console.error("✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}
if (!openrouterKey) {
  console.error("✗ Missing OPENROUTER_API_KEY in .env.local")
  process.exit(1)
}

console.log("✓ Credentials read from .env.local")

// ---------------------------------------------------------------------------
// 2. Get Supabase user ID
// ---------------------------------------------------------------------------

console.log("  Fetching user ID from Supabase...")

let userId
try {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    },
    signal: AbortSignal.timeout(10_000)
  })

  if (!res.ok) {
    console.error(`✗ Supabase auth request failed: HTTP ${res.status}`)
    process.exit(1)
  }

  const data = await res.json()
  const users = data.users ?? data // some versions return array directly
  userId = Array.isArray(users) ? users[0]?.id : null

  if (!userId) {
    console.error("✗ No users found. Have you signed up in ChatMemo yet?")
    process.exit(1)
  }
} catch (err) {
  console.error("✗ Failed to reach Supabase:", err.message)
  process.exit(1)
}

console.log(`✓ User ID: ${userId}`)

// ---------------------------------------------------------------------------
// 3. Write ~/.chatmemo/config.json
// ---------------------------------------------------------------------------

if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })

const config = {
  supabaseUrl,
  serviceRoleKey,
  openrouterKey,
  userId,
  chatmemoUrl: CHATMEMO_URL,
  projectDir: resolve(".")
}

writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
console.log(`✓ Wrote ${CONFIG_FILE}`)

// ---------------------------------------------------------------------------
// 4. Register Stop hook in ~/.claude/settings.json
// ---------------------------------------------------------------------------

let claudeSettings = {}
if (existsSync(CLAUDE_SETTINGS)) {
  try {
    claudeSettings = JSON.parse(readFileSync(CLAUDE_SETTINGS, "utf8"))
  } catch {
    console.warn("  Warning: could not parse ~/.claude/settings.json — will overwrite hooks section")
  }
}

if (!claudeSettings.hooks) claudeSettings.hooks = {}
if (!Array.isArray(claudeSettings.hooks.Stop)) claudeSettings.hooks.Stop = []

const hookCommand = `node ${HOOK_SCRIPT}`
const alreadyRegistered = claudeSettings.hooks.Stop.some(entry =>
  entry.hooks?.some(h => h.command === hookCommand)
)

if (!alreadyRegistered) {
  claudeSettings.hooks.Stop.push({
    matcher: "",
    hooks: [{ type: "command", command: hookCommand }]
  })
  writeFileSync(CLAUDE_SETTINGS, JSON.stringify(claudeSettings, null, 2))
  console.log("✓ Registered Stop hook in ~/.claude/settings.json")
} else {
  console.log("✓ Stop hook already registered (skipped)")
}

// ---------------------------------------------------------------------------
// 5. Generate bookmarklet
// ---------------------------------------------------------------------------

const bookmarkletCode = `(function(){
var CHATMEMO='${CHATMEMO_URL}';
var title=(document.querySelector('h1,h2,[data-testid*="title"]')?.innerText||document.title).replace(/\\s*[-|]\\s*Claude.*$/i,'').trim()||'Claude conversation';
var date=new Date().toISOString().slice(0,10);
var msgs=[];
function getText(el){return(el?.innerText||'').trim()}
var humanEls=[...document.querySelectorAll('[data-testid*="human-turn"],[data-testid*="user-turn"],[class*="HumanTurn"],[class*="human-turn"]')];
var assistEls=[...document.querySelectorAll('[data-testid*="assistant-turn"],[data-testid*="AssistantTurn"],[class*="AssistantTurn"],[class*="assistant-turn"]')];
if(humanEls.length>0){
  var all=[];
  humanEls.forEach(function(el){all.push({el:el,role:'user'})});
  assistEls.forEach(function(el){all.push({el:el,role:'assistant'})});
  all.sort(function(a,b){return a.el.compareDocumentPosition(b.el)&4?-1:1});
  all.forEach(function(t){var tx=getText(t.el);if(tx.length>10)msgs.push({role:t.role,text:tx})});
}
if(msgs.length===0){
  var art=[...document.querySelectorAll('[data-is-streaming],[data-message-author-role]')];
  art.forEach(function(el){
    var role=el.dataset.messageAuthorRole||'user';
    var tx=getText(el);
    if(tx.length>10)msgs.push({role:role,text:tx});
  });
}
if(msgs.length===0){alert('ChatMemo: could not find messages.\\nOpen DevTools → Elements, find a message, right-click → Copy selector, and update the bookmarklet.');return}
fetch(CHATMEMO+'/api/import/conversation',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  credentials:'include',
  body:JSON.stringify({title:title,date:date,messages:msgs})
}).then(function(r){return r.json()}).then(function(d){
  var ok=d.success&&d.inserted>0;
  var n=document.createElement('div');
  n.setAttribute('style','position:fixed;top:16px;right:16px;z-index:99999;background:'+(ok?'#16a34a':d.inserted===0?'#ca8a04':'#dc2626')+';color:#fff;padding:10px 18px;border-radius:8px;font:14px/1.4 sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.25);max-width:320px');
  n.innerText=ok?'✓ Saved to ChatMemo':d.inserted===0?'ℹ ChatMemo: nothing new to save':'✗ ChatMemo error: '+(d.reason||d.message||'unknown');
  document.body.appendChild(n);
  setTimeout(function(){n.remove()},4000);
}).catch(function(){alert('ChatMemo: connection failed.\\nMake sure ChatMemo is running at ${CHATMEMO_URL} and you are logged in.')});
})()`

const bookmarkletUrl = "javascript:" + encodeURIComponent(bookmarkletCode)

console.log("\n" + "─".repeat(60))
console.log("📌  BOOKMARKLET")
console.log("─".repeat(60))
console.log("1. Copy the URL below")
console.log("2. In your browser, show the bookmarks bar (⌘+Shift+B)")
console.log("3. Right-click the bar → Add page... → paste as URL")
console.log("   Name it: Save to ChatMemo")
console.log("─".repeat(60))
console.log(bookmarkletUrl)
console.log("─".repeat(60))

console.log("\n✅  Setup complete!")
console.log("\nHow it works:")
console.log("  • Claude Code sessions → synced automatically after every session")
console.log("    (fires when Claude stops, imports once per session with ≥3 turns)")
console.log("  • Claude.ai browser → click the bookmarklet on any conversation")
console.log("    (ChatMemo must be open in another tab so the session cookie is active)")
