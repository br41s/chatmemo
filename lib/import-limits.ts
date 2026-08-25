// How large an import file may actually be.
//
// The routes used to declare a 100 MB limit and read the whole upload into
// memory. Neither number was reachable: the platform these run on caps a
// serverless request body at roughly 4.5 MB, so a real ChatGPT export was
// rejected before the route ever ran, and the person saw a bare status code
// with no explanation of what to do about it.
//
// This is the honest number, checked in the browser before anything is sent so
// the message can say something useful, and re-checked in the route because a
// client-side check is a courtesy rather than a control.

/** Held under the platform's ~4.5 MB body cap, with room for the multipart
 *  envelope around the file itself. */
export const MAX_IMPORT_FILE_BYTES = 4 * 1024 * 1024

export const MAX_IMPORT_FILE_MB = MAX_IMPORT_FILE_BYTES / 1024 / 1024

/**
 * What to tell someone whose export is too large.
 *
 * A ChatGPT or Claude archive routinely runs to tens of megabytes, so this is
 * the expected case for a heavy user, not an edge case — the message has to
 * name the way forward, not just the rule.
 */
export function importTooLargeMessage(fileName: string, bytes: number): string {
  const mb = (bytes / 1024 / 1024).toFixed(1)
  return (
    `${fileName} is ${mb} MB, over the ${MAX_IMPORT_FILE_MB} MB limit. ` +
    `Split the export into smaller files and import them one at a time — ` +
    `each import picks up where the last left off, so nothing is duplicated.`
  )
}
