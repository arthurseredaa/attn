export class RateLimitError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RateLimitError';
  }
}

/** The provider rejected the credentials or the model id; every further call would fail the same way. */
export class FatalLabelerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FatalLabelerError';
  }
}
