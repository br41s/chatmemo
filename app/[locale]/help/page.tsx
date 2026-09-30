"use client"

import { ChatMemoSVG } from "@/components/icons/chatmemo-svg"
import { MemorySourceChip } from "@/components/memory/memory-source-chip"
import {
  IconArrowLeft,
  IconBrain,
  IconBrandGithub,
  IconDots,
  IconMessage,
  IconMoon,
  IconTimeline
} from "@tabler/icons-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ReactNode } from "react"
import { SHORTCUTS } from "@/lib/shortcuts"

const GUIDE_URL =
  "https://github.com/br41s/chatmemo/blob/main/docs/USER_GUIDE.md"
const REPO_URL = "https://github.com/br41s/chatmemo"

/**
 * What ChatMemo does and how to use it, for the person using it.
 *
 * It was a placeholder that said "under construction". The popover behind
 * the ? in the chat linked here, so the one place the interface pointed to
 * for help was empty. This page explains the memory — the part that is not
 * obvious from the screen — and lists the shortcuts; the long form stays in
 * the user guide it links to.
 */
export default function HelpPage() {
  return (
    <div className="size-full overflow-y-auto">
      <main className="mx-auto w-full max-w-2xl px-6 pb-24 pt-8">
        <BackLink />

        <header className="mt-8 flex flex-col items-center text-center">
          <ChatMemoSVG scale={0.22} />
          <h1 className="mt-3 text-3xl font-bold tracking-tight">
            ChatMemo help
          </h1>
          <p className="mt-2 text-muted-foreground">
            One memory across your AI conversations. This page explains what the
            memory is made of, how to see what an answer was given, and how to
            get more of your history into it.
          </p>
        </header>

        <Section title="What the model is told about you">
          <p>
            Every message you send goes to the model with a memory block in
            front of it, sized to what the model&apos;s context window can hold.
            It has up to four parts:
          </p>
          <Terms
            items={[
              [
                "Lessons",
                "Durable facts learned about you over time: how you like answers, what you are working on, hard requirements. Rewritten as new chats teach it more. Read first, every turn."
              ],
              [
                "Conversation history",
                "Your past conversations as dated summaries, newest first — chats here, Claude Code sessions, and whatever you imported from ChatGPT, Claude or Perplexity."
              ],
              [
                "Relevant matches",
                "The stored conversations closest to what you just asked, in more detail than the history carries. Where the specific dates, numbers and decisions come from."
              ],
              [
                "A recovered transcript",
                "Only when you ask for one: the full text of a conversation, verbatim. Ask to recover the conversation about something, or for what was said yesterday or last week."
              ]
            ]}
          />
        </Section>

        <Section title="Seeing what an answer was given">
          <p>
            While an answer is on its way, the wait says what is being
            remembered: the conversations by name, in the colour of where they
            came from.
          </p>
          <div className="my-3 flex flex-wrap gap-1.5">
            <MemorySourceChip source="claude-ai" />
            <MemorySourceChip source="claude-code" />
            <MemorySourceChip source="chatgpt" />
            <MemorySourceChip source="perplexity" />
            <MemorySourceChip source="chat" />
          </div>
          <p>
            Under each answer, a line says how much memory it was given and from
            which sources. Open it to see the matched conversations with their
            dates, how far back the history reached, and how much of the
            allowance was used. An answer that claims a fact you cannot find in
            that list should be doubted: the model is told to say when it does
            not know, and that line is how you check.
          </p>
        </Section>

        <Section title="Things to ask">
          <ul className="space-y-2">
            <Try q="What have we talked about recently?" />
            <Try q="What do you know about me so far?" />
            <Try q="What did we talk about yesterday?" />
            <Try q="Recover the full conversation about the Vercel deploy." />
          </ul>
          <p className="mt-3">
            The first two read the history. The last two trigger a transcript
            search, which is the one way to get a conversation back word for
            word. If nothing matches, the answer says so instead of guessing.
          </p>
        </Section>

        <Section title="Getting your history in">
          <Terms
            items={[
              [
                <Rail icon={<IconBrain size={18} />} label="Memory" key="m" />,
                "Everything stored, newest first, with search and delete. The import buttons take the export files ChatGPT, Claude and Perplexity produce; conversations already imported are skipped. Backup downloads one file per source; restore takes them back."
              ],
              [
                <Rail
                  icon={<IconTimeline size={18} />}
                  label="Timeline"
                  key="t"
                />,
                "The same conversations by date, filtered by source or keyword, with a reader for each one."
              ],
              [
                "Claude Code",
                "Sessions on this machine are summarised into memory by the sync scripts; cloud sessions post themselves through a hook. Both are set up from the repository, not from here."
              ],
              [
                "This app",
                "Each chat here is summarised into memory once it has a few turns, and the lessons are rewritten when a chat teaches something new. Nothing to do."
              ]
            ]}
          />
        </Section>

        <Section title="Around the chat">
          <Terms
            items={[
              [
                <Rail icon={<IconMessage size={18} />} label="Chats" key="c" />,
                "Your conversations here, in folders if you want them."
              ],
              [
                <Rail icon={<IconDots size={18} />} label="More" key="d" />,
                "Presets, models, collections, assistants and tools — the parts you set up once."
              ],
              [
                <Rail icon={<IconMoon size={18} />} label="Theme" key="l" />,
                "Light or dark, at the bottom of the rail. Profile settings, with your API keys, are below it."
              ]
            ]}
          />
        </Section>

        <Section title="Keyboard shortcuts">
          <p className="mb-3">
            All of these are <Key>⌘</Key> <Key>⇧</Key> and a key.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            {SHORTCUTS.map(({ key, label, does }) => (
              <div key={key} className="contents">
                <dt>
                  <Key>{label ?? key}</Key>
                </dt>
                <dd className="text-muted-foreground">{does}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="More">
          <p>
            The{" "}
            <a
              className="underline decoration-brand/60 underline-offset-4 hover:text-brand"
              href={GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              user guide
            </a>{" "}
            covers imports, the sync scripts, models, tools and backup in
            detail.
          </p>
          <a
            className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <IconBrandGithub size={18} />
            ChatMemo on GitHub
          </a>
        </Section>
      </main>
    </div>
  )
}

/** Back to wherever the person came from. The chat opens this page in a
 *  new tab, where there is nowhere to go back to; then it goes home. */
function BackLink() {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() =>
        window.history.length > 1 ? router.back() : router.push("/")
      }
      className="inline-flex items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <IconArrowLeft size={16} />
      Back
    </button>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="text-sm leading-relaxed text-foreground/90">
        {children}
      </div>
    </section>
  )
}

function Terms({ items }: { items: Array<[ReactNode, string]> }) {
  return (
    <dl className="mt-3 space-y-3">
      {items.map(([term, detail], index) => (
        <div key={index}>
          <dt className="font-medium">{term}</dt>
          <dd className="text-muted-foreground">{detail}</dd>
        </div>
      ))}
    </dl>
  )
}

function Rail({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-brand">{icon}</span>
      {label}
    </span>
  )
}

function Try({ q }: { q: string }) {
  return (
    <li className="rounded-full border px-3 py-1.5 text-sm text-muted-foreground">
      {q}
    </li>
  )
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block min-w-[28px] rounded border px-1.5 py-0.5 text-center font-mono text-xs">
      {children}
    </kbd>
  )
}
