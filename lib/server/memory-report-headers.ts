import {
  encodeMemoryReport,
  MEMORY_REPORT_HEADER,
  MemoryReport
} from "@/lib/memory-report"

/**
 * Response headers carrying the turn's memory report.
 *
 * Returns an empty object when the report cannot be encoded, so a chat
 * response is never withheld or broken over what is, in the end, an
 * explanatory annotation. The client treats a missing header as "no
 * information" and shows nothing.
 *
 * `Access-Control-Expose-Headers` is set because the browser hides
 * non-simple response headers from `fetch` unless the server names them, and
 * a self-hosted deployment may sit behind a different origin.
 */
export function memoryReportHeaders(
  report: MemoryReport
): Record<string, string> {
  const encoded = encodeMemoryReport(report)
  if (!encoded) return {}

  return {
    [MEMORY_REPORT_HEADER]: encoded,
    "Access-Control-Expose-Headers": MEMORY_REPORT_HEADER
  }
}
