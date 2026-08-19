// Page bounds for the routes that read the summaries table.
//
// history, timeline and export all used to select every row for the user with
// no limit. That is the table bulk imports are designed to fill, so the
// response grew in direct proportion to the feature that sells the product —
// thousands of rows of up to 10k chars each, serialised into one JSON body.

export interface PageParams {
  limit: number
  offset: number
}

export interface PageBounds {
  defaultLimit: number
  maxLimit: number
}

/** Browse panels: enough to fill the sheet, "Load more" for the rest. */
export const HISTORY_PAGE: PageBounds = { defaultLimit: 50, maxLimit: 200 }

/** Timeline groups rows into dated entries, so it reads in larger pages. */
export const TIMELINE_PAGE: PageBounds = { defaultLimit: 200, maxLimit: 500 }

/** Backup export stays complete; the client loops until nextOffset is null. */
export const EXPORT_PAGE: PageBounds = { defaultLimit: 500, maxLimit: 1_000 }

/**
 * Read `limit` and `offset` off a request URL, clamped to the given bounds.
 *
 * Anything unusable — absent, non-numeric, negative, fractional, over the
 * maximum — falls back to a value inside the bounds rather than reaching the
 * query, so a hand-edited URL cannot reinstate an unbounded read.
 *
 * Pure + exported so the clamping can be unit-tested without a request.
 */
export function parsePageParams(
  searchParams: URLSearchParams,
  bounds: PageBounds
): PageParams {
  return {
    limit: clampInt(
      searchParams.get("limit"),
      bounds.defaultLimit,
      1,
      bounds.maxLimit
    ),
    offset: clampInt(searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER)
  }
}

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === null || raw.trim() === "") return fallback

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback

  const truncated = Math.trunc(parsed)
  if (truncated < min) return fallback
  return Math.min(truncated, max)
}

/**
 * Given `limit + 1` fetched rows, split them into the page to return and
 * whether another page exists. Fetching one extra row is how these routes
 * answer "is there more?" without a second COUNT query.
 */
export function takePage<T>(
  rows: T[],
  limit: number,
  offset: number
): { page: T[]; nextOffset: number | null } {
  const hasMore = rows.length > limit
  return {
    page: hasMore ? rows.slice(0, limit) : rows,
    nextOffset: hasMore ? offset + limit : null
  }
}
