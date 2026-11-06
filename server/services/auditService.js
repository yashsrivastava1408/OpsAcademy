/**
 * Audit trail for admin and trainer actions. Writing it must never break the
 * action itself, so a failure is logged and swallowed.
 */
const logger = require('../lib/logger');
const { getRepos } = require('../repositories');

/**
 * @param {import('express').Request|null} req  the request (actor and IP come from it); null for scripts
 * @param {string} action  e.g. 'college.create'
 * @param {{ entityType?: string, entityId?: string, collegeId?: string|null, meta?: object }} details
 */
async function record(req, action, { entityType = null, entityId = null, collegeId = null, meta = {} } = {}) {
  try {
    const user = req && req.user;
    const roles = (user && user.roles) || [];
    const actorRole = roles.includes('platform_admin') ? 'platform_admin' : roles[0] || null;
    await getRepos().audit.record({
      actorId: user ? user.id : null,
      actorRole,
      action,
      entityType,
      entityId,
      collegeId,
      ip: req && req.ip ? req.ip.replace(/^::ffff:/, '') : null,
      meta,
    });
  } catch (err) {
    logger.error({ action, err: err.message }, 'could not write the audit log');
  }
}

function list(filter) {
  return getRepos().audit.list(filter);
}

module.exports = { record, list };
