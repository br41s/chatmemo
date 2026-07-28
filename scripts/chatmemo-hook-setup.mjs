#!/usr/bin/env node
/**
 * ChatMemo sync setup — run once from the chatmemo project root:
 *
 *   npm run setup:sync
 *
 * What it does:
 *  1. Reads credentials from .env.local
 *  2. Gets your Supabase user ID (first registered user via service role)
 *  3. Writes CHATMEMO_IMPORT_USER_ID to .env.local (used by the API endpoint)
 *  4. Writes ~/.chatmemo/config.json (used by the hook script)
 *  5. Registers the Stop hook in ~/.claude/settings.json
 *  6. Prints the bookmarklet URL — drag it to your bookmarks bar
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join, resolve } from "path"

const CONFIG_DIR = join(homedir(), ".chatmemo")
const CONFIG_FILE = join(CONFIG_DIR, "config.json")
const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json")
const HOOK_SCRIPT = resolve("scripts/sync-to-chatmemo.mjs")
const ENV_PATH = resolve(".env.local")

// ---------------------------------------------------------------------------
// 1. Read .env.local
// ---------------------------------------------------------------------------

if (!existsSync(ENV_PATH)) {
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

const env = readEnv(ENV_PATH)
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
const openrouterKey = env.OPENROUTER_API_KEY
const importToken = env.CHATMEMO_IMPORT_TOKEN

// Where the bookmarklet POSTs. ChatMemo runs on Vercel in production; override
// with CHATMEMO_PUBLIC_URL in .env.local for a different deployment or local
// dev (e.g. http://localhost:3000).
const CHATMEMO_URL =
  env.CHATMEMO_PUBLIC_URL || "https://chatmemo-one.vercel.app"

if (!supabaseUrl || !serviceRoleKey || serviceRoleKey === "your-service-role-key") {
  console.error("✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}
if (!openrouterKey) {
  console.error("✗ Missing OPENROUTER_API_KEY in .env.local")
  process.exit(1)
}
if (!importToken) {
  console.error("✗ Missing CHATMEMO_IMPORT_TOKEN in .env.local")
  console.error("  Add this line to .env.local:  CHATMEMO_IMPORT_TOKEN=<random-hex-token>")
  console.error("  Generate one with: node -e \"require('crypto').randomBytes(32, (_,b)=>console.log(b.toString('hex')))\"")
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
// 3. Write CHATMEMO_IMPORT_USER_ID to .env.local
// ---------------------------------------------------------------------------

let envContent = readFileSync(ENV_PATH, "utf8")

if (envContent.includes("CHATMEMO_IMPORT_USER_ID=")) {
  // Update existing value
  envContent = envContent.replace(
    /^CHATMEMO_IMPORT_USER_ID=.*$/m,
    `CHATMEMO_IMPORT_USER_ID=${userId}`
  )
} else {
  // Insert after CHATMEMO_IMPORT_TOKEN line
  envContent = envContent.replace(
    /^(CHATMEMO_IMPORT_TOKEN=.*)$/m,
    `$1\nCHATMEMO_IMPORT_USER_ID=${userId}`
  )
}

writeFileSync(ENV_PATH, envContent)
console.log("✓ Wrote CHATMEMO_IMPORT_USER_ID to .env.local")

// ---------------------------------------------------------------------------
// 4. Write ~/.chatmemo/config.json
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
// 5. Register Stop hook in ~/.claude/settings.json
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
// 6. Generate bookmarklet
// ---------------------------------------------------------------------------

// claude.ai DOM selectors (updated 2026-05):
//   User messages:      [class*="font-user-message"]
//   Assistant messages: [class*="font-claude-message"] or .prose containers
//   Fallback:           data-message-author-role attribute

const bookmarkletCode = `(function(){
var CHATMEMO='${CHATMEMO_URL}';
var TOKEN='${importToken}';
var title=(document.querySelector('h1,h2,[data-testid*="title"],[class*="conversation-title"]')?.innerText||document.title).replace(/\\s*[-|]\\s*Claude.*$/i,'').trim()||'Claude conversation';
var date=new Date().toISOString().slice(0,10);
var msgs=[];
function getText(el){return(el?.innerText||'').trim()}

/* Strategy 1: role-based data attribute (future-proof) */
var roleEls=[...document.querySelectorAll('[data-message-author-role]')];
if(roleEls.length>0){
  roleEls.forEach(function(el){
    var role=el.dataset.messageAuthorRole;
    if(role!=='user'&&role!=='assistant')return;
    var tx=getText(el);
    if(tx.length>10)msgs.push({role:role,text:tx});
  });
}

/* Strategy 2: claude.ai class-based selectors */
if(msgs.length===0){
  var userEls=[...document.querySelectorAll('[class*="font-user-message"]')];
  var assistEls=[...document.querySelectorAll('[class*="font-claude-response"]')];
  if(userEls.length>0||assistEls.length>0){
    var all=[];
    userEls.forEach(function(el){all.push({el:el,role:'user'})});
    assistEls.forEach(function(el){all.push({el:el,role:'assistant'})});
    all.sort(function(a,b){return a.el.compareDocumentPosition(b.el)&4?-1:1});
    all.forEach(function(t){var tx=getText(t.el);if(tx.length>10)msgs.push({role:t.role,text:tx})});
  }
}

/* Strategy 3: generic article/turn containers */
if(msgs.length===0){
  var arts=[...document.querySelectorAll('[data-testid*="human-turn"],[data-testid*="assistant-turn"],[class*="HumanTurn"],[class*="AssistantTurn"],[class*="human-turn"],[class*="assistant-turn"]')];
  arts.forEach(function(el){
    var cls=el.className||'';
    var role=(cls.toLowerCase().includes('human')||cls.toLowerCase().includes('user'))?'user':'assistant';
    var tx=getText(el);
    if(tx.length>10)msgs.push({role:role,text:tx});
  });
}

if(msgs.length===0){
  alert('ChatMemo: could not find messages.\\nTry refreshing the page or open the conversation fully before clicking.');
  return;
}

fetch(CHATMEMO+'/api/import/conversation',{
  method:'POST',
  headers:{'Content-Type':'application/json','Authorization':'Bearer '+TOKEN},
  body:JSON.stringify({title:title,date:date,messages:msgs})
}).then(function(r){return r.json()}).then(function(d){
  var ok=d.success&&d.inserted>0;
  var n=document.createElement('div');
  n.setAttribute('style','position:fixed;top:16px;right:16px;z-index:99999;background:'+(ok?'#16a34a':d.inserted===0?'#ca8a04':'#dc2626')+';color:#fff;padding:10px 18px;border-radius:8px;font:14px/1.4 sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.25);max-width:320px');
  n.innerText=ok?'✓ Saved to ChatMemo ('+msgs.length+' msgs)':d.inserted===0?'ℹ ChatMemo: nothing new to save':'✗ ChatMemo error: '+(d.reason||d.message||'unknown');
  document.body.appendChild(n);
  setTimeout(function(){n.remove()},4000);
}).catch(function(e){alert('ChatMemo: connection failed.\\nMake sure ChatMemo is running at ${CHATMEMO_URL}.\\nError: '+e.message)});
})()`

const bookmarkletUrl = "javascript:" + encodeURIComponent(bookmarkletCode)

// ---------------------------------------------------------------------------
// 6b. Gemini bookmarklet (gemini.google.com)
//
// Same endpoint, payload and Bearer-token auth as the Claude one — only the
// DOM extraction differs. Gemini renders turns as Angular custom elements
// <user-query> / <model-response>; a class-based pass is the fallback.
// ---------------------------------------------------------------------------

const geminiBookmarkletCode = `(function(){
var CHATMEMO='${CHATMEMO_URL}';
var TOKEN='${importToken}';
var date=new Date().toISOString().slice(0,10);
function getText(el){return(el?.innerText||'').trim()}
var title=(document.title||'').replace(/\\s*[-|]\\s*(Google\\s*)?Gemini.*$/i,'').trim();
var msgs=[];

/* Strategy 1: Angular custom elements (document order is turn order) */
[...document.querySelectorAll('user-query, model-response')].forEach(function(el){
  var role=el.tagName.toLowerCase()==='user-query'?'user':'assistant';
  var tx=getText(el);
  if(tx.length>2)msgs.push({role:role,text:tx});
});

/* Strategy 2: class-based fallback, ordered by document position */
if(msgs.length===0){
  var all=[];
  [...document.querySelectorAll('.query-text')].forEach(function(el){all.push({el:el,role:'user'})});
  [...document.querySelectorAll('.model-response-text,message-content .markdown')].forEach(function(el){all.push({el:el,role:'assistant'})});
  all.sort(function(a,b){return a.el.compareDocumentPosition(b.el)&4?-1:1});
  all.forEach(function(t){var tx=getText(t.el);if(tx.length>2)msgs.push({role:t.role,text:tx})});
}

if(msgs.length===0){
  alert('ChatMemo: could not find Gemini messages.\\nScroll up to load the full conversation, then click again.');
  return;
}
if(!title){var fm=msgs.find(function(m){return m.role==='user'});title=fm?fm.text.slice(0,60):'Gemini conversation';}

fetch(CHATMEMO+'/api/import/conversation',{
  method:'POST',
  headers:{'Content-Type':'application/json','Authorization':'Bearer '+TOKEN},
  body:JSON.stringify({title:title,date:date,messages:msgs})
}).then(function(r){return r.json()}).then(function(d){
  var ok=d.success&&d.inserted>0;
  var n=document.createElement('div');
  n.setAttribute('style','position:fixed;top:16px;right:16px;z-index:99999;background:'+(ok?'#16a34a':d.inserted===0?'#ca8a04':'#dc2626')+';color:#fff;padding:10px 18px;border-radius:8px;font:14px/1.4 sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.25);max-width:320px');
  n.innerText=ok?'✓ Saved to ChatMemo ('+msgs.length+' msgs)':d.inserted===0?'ℹ ChatMemo: nothing new to save':'✗ ChatMemo error: '+(d.reason||d.message||'unknown');
  document.body.appendChild(n);
  setTimeout(function(){n.remove()},4000);
}).catch(function(e){alert('ChatMemo: connection failed.\\nMake sure ChatMemo is running at ${CHATMEMO_URL}.\\nError: '+e.message)});
})()`

const geminiBookmarkletUrl =
  "javascript:" + encodeURIComponent(geminiBookmarkletCode)

function printBookmarklet(label, sites, url) {
  console.log("\n" + "─".repeat(60))
  console.log(`📌  BOOKMARKLET — ${label}`)
  console.log(`    Use on: ${sites}`)
  console.log("─".repeat(60))
  console.log("1. Copy the URL below")
  console.log("2. In your browser, show the bookmarks bar (⌘+Shift+B)")
  console.log("3. Right-click the bar → Add page... → paste as URL")
  console.log(`   Name it: ${label}`)
  console.log("─".repeat(60))
  console.log(url)
  console.log("─".repeat(60))
}

printBookmarklet("Save to ChatMemo (Claude)", "claude.ai", bookmarkletUrl)
printBookmarklet(
  "Save to ChatMemo (Gemini)",
  "gemini.google.com",
  geminiBookmarkletUrl
)

console.log("\n✅  Setup complete!")
console.log("\nHow it works:")
console.log("  • Claude Code sessions → synced automatically after every session")
console.log("    (fires when Claude stops, imports once per session with ≥3 turns)")
console.log("  • Claude.ai browser → click the Claude bookmarklet on a conversation")
console.log("  • Gemini browser → click the Gemini bookmarklet on a conversation")
console.log("    (ChatMemo does NOT need to be open — uses Bearer token auth)")
