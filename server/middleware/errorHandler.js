/**
 * Global error handler middleware
 */

const config = require('../config');
const logger = require('../lib/logger');

// Repository failures the caller can understand; anything else stays a 500.
const REPO_STATUS = {
  user_missing: [401, 'Unknown account. Sign in again (or call POST /api/auth/session after signing in).'],
  email_taken: [409, 'User with this email already exists'],
  slug_taken: [409, 'That profile address is taken'],
};

function errorHandler(err, req, res, _next) {
  const mapped = err.code && REPO_STATUS[err.code];
  if (mapped && !err.statusCode) {
    err.statusCode = mapped[0];
    err.message = mapped[1];
  }
  const statusCode = err.statusCode || err.status || 500;

  if (statusCode >= 500) logger.error({ err, path: req.path }, 'request failed');

  res.status(statusCode).json({
    success: false,
    // Internal error details stay in the logs in production.
    error: statusCode >= 500 && config.isProd ? 'Internal Server Error' : err.message || 'Internal Server Error',
  });
}

module.exports = errorHandler;
