/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { MessageMemory } from "../../components/messages/message-memory"
import type { MemoryReport } from "../../lib/memory-report"

// What this file defends: the panel under an answer is how a person checks
// what the model was told, so it must not print an impossible line. The
// allowance is a target the layers are sized from — their shares add up to a
// little over it and lessons sit outside it — and "115k of 100k (100%)" was
// both wrong arithmetic and a hidden overrun.

const report = (overrides: Partial<MemoryReport>): MemoryReport => ({
  injected: true,
  totalChars: 40_000,
  budgetChars: 100_000,
  history: { chars: 40_000, entries: 12 },
  ...overrides
})

const open = () =>
  fireEvent.click(screen.getByRole("button", { name: /memory entries used/ }))

describe("MessageMemory", () => {
  it("shows the share of the allowance when the block fits", () => {
    render(<MessageMemory report={report({})} />)
    open()
    expect(
      screen.getByText(/40k chars of\s+100k chars allowance \(40%\)/)
    ).toBeTruthy()
  })

  it("says how far over the allowance the block ran, instead of 100%", () => {
    render(<MessageMemory report={report({ totalChars: 115_000 })} />)
    open()
    expect(
      screen.getByText(
        /115k chars sent, 15k chars\s+over the 100k chars allowance/
      )
    ).toBeTruthy()
    expect(screen.queryByText(/100%/)).toBeNull()
  })

  it("lists the remembered conversations with their source named", () => {
    render(
      <MessageMemory
        report={report({
          relevant: {
            chars: 900,
            entries: 1,
            items: [
              {
                title: "Recipe for paella",
                source: "chatgpt",
                date: "2026-08-01",
                more: 2
              }
            ]
          }
        })}
      />
    )
    open()
    expect(screen.getByText(/Recipe for paella\s*\+2/)).toBeTruthy()
    expect(screen.getByText("2026-08-01")).toBeTruthy()
    // The source is text for a screen reader, not only a colour.
    expect(screen.getAllByText(/ChatGPT/).length).toBeGreaterThan(0)
  })
})
