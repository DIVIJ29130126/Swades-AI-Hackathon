/**
 * Retry logic with exponential backoff
 * Ensures transient failures don't lose data
 */

export interface RetryOptions {
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  shouldRetry?: (error: unknown) => boolean
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 2,
  initialDelayMs: 50,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
  shouldRetry: (error: unknown) => {
    // Retry on network errors, timeouts, 5xx errors
    if (error instanceof Error) {
      const message = error.message.toLowerCase()
      return (
        message.includes("network") ||
        message.includes("timeout") ||
        message.includes("connection") ||
        message.includes("fetch")
      )
    }
    return false
  },
}

/**
 * Retry a function with exponential backoff
 * Useful for uploading chunks when network is flaky
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  let lastError: unknown
  let delayMs = opts.initialDelayMs

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt === opts.maxAttempts) {
        break
      }

      // Check if we should retry this error
      if (!opts.shouldRetry(error)) {
        throw error
      }

      // Exponential backoff with jitter to avoid thundering herd
      const jitter = Math.random() * 0.2 * delayMs
      await new Promise((resolve) => setTimeout(resolve, delayMs + jitter))

      delayMs = Math.min(delayMs * opts.backoffMultiplier, opts.maxDelayMs)
    }
  }

  throw lastError
}

/**
 * Exponential backoff delay calculation
 * Useful for scheduling retries
 */
export function calculateBackoffDelay(
  attempt: number,
  initialDelayMs: number = 1000,
  maxDelayMs: number = 30000,
  multiplier: number = 2
): number {
  const delay = initialDelayMs * Math.pow(multiplier, attempt - 1)
  return Math.min(delay, maxDelayMs)
}

/**
 * Classify error as retriable or not
 */
export function isRetriableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const retriable = [
    "Network",
    "Timeout",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "408", // Request Timeout
    "429", // Too Many Requests
    "500", // Internal Server Error
    "502", // Bad Gateway
    "503", // Service Unavailable
    "504", // Gateway Timeout
  ]

  return retriable.some((pattern) => error.message.includes(pattern))
}
