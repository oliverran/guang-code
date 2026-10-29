/**
 * A bounded wait for a stage's own work.
 *
 * Both stages of the loop — the proposer that edits a harness and the probe that runs one —
 * wait for an agent session that may never finish. Each stage needs the same thing: a wait
 * that ends at the deadline, ends when the caller cancels, and leaves no timer behind.
 *
 * The wait does not stop the agent. It stops the WAITING. The agent's own disposal is what
 * ends its work, and each stage disposes its agent in a `finally`.
 *
 * @module
 */

/**
 * Await a promise, or fail when the deadline passes.
 *
 * The error names the stage that ran out of time, so a caller reading a failure knows which
 * wait ended and not merely that something did.
 * @param promise - the work to await.
 * @param timeoutMs - the deadline in milliseconds.
 * @param signal - a signal that cancels the wait.
 * @param subject - the stage's name, used in the timeout message.
 * @returns the promise's value.
 * @throws when the deadline passes or the signal aborts.
 */
export async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
  subject: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(`the ${subject} exceeded ${timeoutMs}ms`)) }, timeoutMs)
  })
  const cancelled = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(`the ${subject} was cancelled`))
      return
    }
    signal.addEventListener('abort', () => { reject(new Error(`the ${subject} was cancelled`)) }, { once: true })
  })
  try {
    return await Promise.race([promise, timeout, cancelled])
  } finally {
    /* v8 ignore next -- the timeout promise's executor runs synchronously, so the timer is always assigned here. */
    if (timer !== undefined) clearTimeout(timer)
  }
}
