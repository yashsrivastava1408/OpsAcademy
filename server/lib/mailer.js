/**
 * Outgoing email (password reset and email confirmation links).
 *
 * Drivers:
 *   log     the default. Nothing is sent; the message is written to the
 *           server log. Enough for local development and demos.
 *   resend  sends through the Resend HTTP API (needs RESEND_API_KEY and a
 *           MAIL_FROM address on a domain verified there).
 *   memory  keeps messages in an array (tests).
 */

const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

const RESEND_URL = 'https://api.resend.com/emails';

function createMailer({ driver = config.mail.driver, apiKey = config.mail.resendApiKey, from = config.mail.from, http = axios } = {}) {
  const outbox = [];

  async function send({ to, subject, text }) {
    if (driver === 'memory') {
      outbox.push({ to, subject, text });
      return true;
    }
    if (driver === 'resend') {
      try {
        await http.post(RESEND_URL, { from, to: [to], subject, text }, {
          timeout: 8000,
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return true;
      } catch (err) {
        // The caller answers the same either way, so a mail outage cannot be
        // used to find out which addresses have accounts.
        logger.error({ err: err.message, subject }, '[Mailer] could not send email');
        return false;
      }
    }
    logger.info({ to, subject, text }, '[Mailer] email not sent (MAIL_DRIVER=log)');
    return true;
  }

  return {
    send,
    outbox,
    driver,
    /** True when a message really reaches the person's inbox. */
    delivers: driver === 'resend',
  };
}

let defaultMailer = null;

function getMailer() {
  if (!defaultMailer) defaultMailer = createMailer();
  return defaultMailer;
}

/** Replace the shared mailer (tests). */
function setMailer(mailer) {
  defaultMailer = mailer;
}

module.exports = { createMailer, getMailer, setMailer };
