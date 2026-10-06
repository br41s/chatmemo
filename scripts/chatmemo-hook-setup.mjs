#!/usr/bin/env node
/**
 * ChatMemo sync setup — run once from the chatmemo project root:
 *
 *   npm run setup:sync
 *
 * What it does:
 *  1. Reads credentials from .env.local
 *  2. Finds your Supabase user: the one CHATMEMO_OWNER_EMAIL names, or the
 *     only one there is
 *  3. Writes CHATMEMO_IMPORT_USER_ID to .env.local (used by the API endpoint)
 *  4. Writes ~/.chatmemo/config.json (the import token and the deployment
 *     URL — no database or OpenRouter key leaves .env.local)
 *  5. Registers the Stop and SessionEnd hooks in ~/.claude/settings.json
 *  6. Writes the bookmarklets to ~/.chatmemo/bookmarklets.txt
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "fs"
import { homedir } from "os"
import { join, resolve } from "path"

const CONFIG_DIR = join(homedir(), ".chatmemo")
const CONFIG_FILE = join(CONFIG_DIR, "config.json")
const BOOKMARKLETS_FILE = join(CONFIG_DIR, "bookmarklets.txt")
const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json")
const HOOK_SCRIPT = resolve("scripts/sync-to-chatmemo.mjs")
const ENV_PATH = resolve(".env.local")

// ---------------------------------------------------------------------------
// 1. Read .env.local
// ---------------------------------------------------------------------------

if (!existsSync(ENV_PATH)) {
  console.error(
    "✗ .env.local not found. Run this script from the chatmemo project root."
  )
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
const importToken = env.CHATMEMO_IMPORT_TOKEN
const ownerEmail = (env.CHATMEMO_OWNER_EMAIL || "").toLowerCase()

// Where the scripts and the bookmarklets POST. ChatMemo runs on Vercel in
// production; override with CHATMEMO_PUBLIC_URL in .env.local for a different
// deployment. The token travels in a header, so only https is accepted.
const CHATMEMO_URL =
  env.CHATMEMO_PUBLIC_URL || "https://chatmemo-one.vercel.app"

if (
  !supabaseUrl ||
  !serviceRoleKey ||
  serviceRoleKey === "your-service-role-key"
) {
  console.error(
    "✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
  )
  process.exit(1)
}
if (!importToken) {
  console.error("✗ Missing CHATMEMO_IMPORT_TOKEN in .env.local")
  console.error(
    "  Add this line to .env.local:  CHATMEMO_IMPORT_TOKEN=<random-hex-token>"
  )
  console.error(
    "  Generate one with: node -e \"require('crypto').randomBytes(32, (_,b)=>console.log(b.toString('hex')))\""
  )
  process.exit(1)
}
if (!CHATMEMO_URL.startsWith("https://")) {
  console.error(`✗ CHATMEMO_PUBLIC_URL must be https — got ${CHATMEMO_URL}`)
  process.exit(1)
}

console.log("✓ Credentials read from .env.local")

// ---------------------------------------------------------------------------
// 2. Find the owner
//
// Every token resolves to this one user, so it has to be the right one. With
// several accounts in the project, "the first user the API lists" is whoever
// signed up last; the email in .env.local is what decides.
// ---------------------------------------------------------------------------

console.log("  Looking up your user in Supabase...")

async function listUsers() {
  const users = []
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=50`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        },
        signal: AbortSignal.timeout(10_000)
      }
    )
    if (!res.ok)
      throw new Error(`Supabase auth request failed: HTTP ${res.status}`)
    const data = await res.json()
    const batch = Array.isArray(data) ? data : data.users ?? []
    users.push(...batch)
    if (batch.length < 50) break
  }
  return users
}

let userId
let userEmail
try {
  const users = await listUsers()
  if (users.length === 0) {
    console.error("✗ No users found. Have you signed up in ChatMemo yet?")
    process.exit(1)
  }
  const candidates = ownerEmail
    ? users.filter(u => (u.email || "").toLowerCase() === ownerEmail)
    : users
  if (candidates.length !== 1) {
    console.error(
      ownerEmail
        ? `✗ ${candidates.length} users match CHATMEMO_OWNER_EMAIL=${ownerEmail}`
        : `✗ ${users.length} users in the project — set CHATMEMO_OWNER_EMAIL in .env.local to say which one is you`
    )
    process.exit(1)
  }
  userId = candidates[0].id
  userEmail = candidates[0].email
} catch (err) {
  console.error("✗ Failed to reach Supabase:", err.message)
  process.exit(1)
}

console.log(`✓ User: ${userEmail} (${userId})`)

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

writeFileSync(ENV_PATH, envContent, { mode: 0o600 })
chmodSync(ENV_PATH, 0o600)
console.log("✓ Wrote CHATMEMO_IMPORT_USER_ID to .env.local (mode 600)")

// ---------------------------------------------------------------------------
// 4. Write ~/.chatmemo/config.json
//
// Only what the scripts need to post: the import token and where to. The
// previous config carried the service-role key, which bypasses row security
// for the whole database, in a world-readable file; `excludeProjects`, if
// present, is kept.
// ---------------------------------------------------------------------------

mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
chmodSync(CONFIG_DIR, 0o700)

let excludeProjects = []
if (existsSync(CONFIG_FILE)) {
  try {
    const previous = JSON.parse(readFileSync(CONFIG_FILE, "utf8"))
    if (Array.isArray(previous.excludeProjects)) {
      excludeProjects = previous.excludeProjects
    }
  } catch {
    // replaced below
  }
}

const config = {
  chatmemoUrl: CHATMEMO_URL,
  importToken,
  excludeProjects,
  projectDir: resolve(".")
}

writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 })
chmodSync(CONFIG_FILE, 0o600)
console.log(`✓ Wrote ${CONFIG_FILE} (mode 600, no database key)`)

// ---------------------------------------------------------------------------
// 5. Register the sync hook in ~/.claude/settings.json
//
// Stop fires after every turn and keeps a long session's summary current;
// SessionEnd gives it a last sync with the turns since. The hook detaches its
// work, so neither makes Claude Code wait.
// ---------------------------------------------------------------------------

let claudeSettings = {}
if (existsSync(CLAUDE_SETTINGS)) {
  try {
    claudeSettings = JSON.parse(readFileSync(CLAUDE_SETTINGS, "utf8"))
  } catch (e) {
    // Writing over a file that did not parse would drop everything else in
    // it — permissions, other hooks — for a stray comma.
    console.error(`✗ Could not parse ${CLAUDE_SETTINGS}: ${e.message}`)
    console.error(
      "  Fix the file and run setup:sync again; nothing was changed."
    )
    process.exit(1)
  }
}

if (!claudeSettings.hooks) claudeSettings.hooks = {}

const hookCommand = `node ${HOOK_SCRIPT}`
let settingsChanged = false

for (const event of ["Stop", "SessionEnd"]) {
  if (!Array.isArray(claudeSettings.hooks[event]))
    claudeSettings.hooks[event] = []
  const alreadyRegistered = claudeSettings.hooks[event].some(entry =>
    entry.hooks?.some(h => h.command === hookCommand)
  )
  if (alreadyRegistered) {
    console.log(`✓ ${event} hook already registered (skipped)`)
    continue
  }
  claudeSettings.hooks[event].push({
    matcher: "",
    hooks: [{ type: "command", command: hookCommand }]
  })
  settingsChanged = true
  console.log(`✓ Registered ${event} hook in ~/.claude/settings.json`)
}

if (settingsChanged) {
  writeFileSync(CLAUDE_SETTINGS, JSON.stringify(claudeSettings, null, 2))
}

// ---------------------------------------------------------------------------
// 6. Generate bookmarklets
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

// The bookmarklets carry the token. They go to a file only this user can
// read, not to the terminal, where they would sit in the scrollback and in
// any transcript of this session.
const bookmarklets = [
  "ChatMemo bookmarklets — each line below is one bookmark's URL.",
  "They contain your import token: keep this file to yourself.",
  "Browser: show the bookmarks bar (⌘+Shift+B), right-click it → Add page…,",
  "paste the URL, and name it as given.",
  "",
  "Save to ChatMemo (Claude) — use on claude.ai:",
  bookmarkletUrl,
  "",
  "Save to ChatMemo (Gemini) — use on gemini.google.com:",
  geminiBookmarkletUrl,
  ""
].join("\n")
writeFileSync(BOOKMARKLETS_FILE, bookmarklets, { mode: 0o600 })
chmodSync(BOOKMARKLETS_FILE, 0o600)
console.log(`✓ Wrote the two bookmarklets to ${BOOKMARKLETS_FILE} (mode 600)`)

console.log("\n✅  Setup complete!")
console.log("\nHow it works:")
console.log(
  "  • Claude Code sessions → posted to ChatMemo as they grow and when they end"
)
console.log(
  "    (from 3 turns, again every 5, and at session end; each replaces the last)"
)
console.log(
  "    Command output and system reminders are dropped and anything shaped"
)
console.log(
  "    like a credential is replaced before the post. Outcomes: ~/.chatmemo/sync.log"
)
console.log(
  "  • To keep a project out: a .chatmemo-nosync file in its directory, or"
)
console.log(`    its path in "excludeProjects" in ${CONFIG_FILE}`)
console.log(
  "  • Claude.ai / Gemini browser → the bookmarklets in " + BOOKMARKLETS_FILE
)
console.log("    (ChatMemo does NOT need to be open — uses Bearer token auth)")
console.log(
  "  • Claude Code cloud sessions → see docs/ADMIN_GUIDE.md; give the cloud"
)
console.log("    environment CHATMEMO_CLOUD_IMPORT_TOKEN, not this token")
