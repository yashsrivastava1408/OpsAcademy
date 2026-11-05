/** A failure the caller can act on. `code` is stable; `message` is for humans. */
class RepoError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

module.exports = { RepoError };
