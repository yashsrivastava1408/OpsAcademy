/**
 * Structured logger — JSON lines in production, readable output in development.
 */

const pino = require('pino');
const config = require('../config');

const level = process.env.LOG_LEVEL || (config.isTest ? 'silent' : 'info');

const logger = pino({
  level,
  base: { service: 'opsacademy-gateway' },
  redact: ['req.headers.authorization', 'req.headers.cookie'],
  ...(config.isProd || config.isTest
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname,service' } } }),
});

module.exports = logger;
