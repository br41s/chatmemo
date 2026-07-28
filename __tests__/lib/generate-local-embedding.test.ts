/** @jest-environment node */

describe("local embedding scheduling", () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it("enforces the global concurrency cap while preserving result order", async () => {
    const pending: Array<(value: { data: number[] }) => void> = []
    const generate = jest.fn(
      () =>
        new Promise<{ data: number[] }>(resolve => {
          pending.push(resolve)
        })
    )
    const pipeline = jest.fn().mockResolvedValue(generate)
    const functionSpy = jest
      .spyOn(global, "Function")
      .mockImplementation(() => (() => Promise.resolve({ pipeline })) as any)

    try {
      const { generateLocalEmbeddings } = await import(
        "../../lib/generate-local-embedding"
      )
      const result = generateLocalEmbeddings(
        ["first", "second", "third"],
        undefined,
        3
      )

      await new Promise(resolve => setImmediate(resolve))
      expect(generate).toHaveBeenCalledTimes(2)

      pending[0]({ data: [0.1] })
      await new Promise(resolve => setImmediate(resolve))
      expect(generate).toHaveBeenCalledTimes(3)

      pending[1]({ data: [0.2] })
      pending[2]({ data: [0.3] })
      await expect(result).resolves.toEqual([[0.1], [0.2], [0.3]])
    } finally {
      functionSpy.mockRestore()
    }
  })

  it("removes an aborted job from the global wait queue", async () => {
    const pending: Array<(value: { data: number[] }) => void> = []
    const generate = jest.fn(
      () =>
        new Promise<{ data: number[] }>(resolve => {
          pending.push(resolve)
        })
    )
    const pipeline = jest.fn().mockResolvedValue(generate)
    const functionSpy = jest
      .spyOn(global, "Function")
      .mockImplementation(() => (() => Promise.resolve({ pipeline })) as any)

    try {
      const { generateLocalEmbedding } = await import(
        "../../lib/generate-local-embedding"
      )
      const first = generateLocalEmbedding("first")
      const second = generateLocalEmbedding("second")
      const controller = new AbortController()
      const third = generateLocalEmbedding("third", controller.signal)

      await new Promise(resolve => setImmediate(resolve))
      expect(generate).toHaveBeenCalledTimes(2)

      controller.abort()
      await expect(third).rejects.toMatchObject({ name: "AbortError" })

      pending[0]({ data: [0.1] })
      pending[1]({ data: [0.2] })
      await expect(Promise.all([first, second])).resolves.toEqual([
        [0.1],
        [0.2]
      ])
      expect(generate).toHaveBeenCalledTimes(2)
    } finally {
      functionSpy.mockRestore()
    }
  })
})
