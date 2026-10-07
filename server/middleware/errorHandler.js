/**
 * Global error handler middleware
 */

const config = require('../config');
const logger = require('../lib/logger');

function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || err.status || 500;

  if (statusCode >= 500) logger.error({ err, path: req.path }, 'request failed');

  res.status(statusCode).json({
    success: false,
    // Internal error details stay in the logs in production.
    error: statusCode >= 500 && config.isProd ? 'Internal Server Error' : err.message || 'Internal Server Error',
  });
}

module.exports = errorHandler;
