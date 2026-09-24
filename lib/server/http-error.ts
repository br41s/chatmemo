/**
 * An error whose message is safe to show the user, with the status to send.
 *
 * Routes answer any HttpError as `{ message }` with its status; everything
 * else is logged and answered as a generic 500.
 */
export class HttpError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "HttpError"
    this.status = status
  }
}
