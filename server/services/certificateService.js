/**
 * Certificate Service — signed completion certificates
 *
 * A certificate is issued only for a unit the learner has completed through
 * sandbox verification. It carries an HMAC-SHA256 signature over its fields,
 * so the public verify endpoint can detect a record that was altered or
 * never issued by this server.
 */

const crypto = require('crypto');
const config = require('../config');
const { getRepos } = require('../repositories');
const units = require('../lib/units');
const progressService = require('./progressService');
const { safeEqual } = require('../middleware/auth');

const SIGNED_FIELDS = ['id', 'userId', 'studentName', 'unitId', 'unitTitle', 'score', 'issuedAt'];

class CertificateError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sign(certificate) {
  const payload = SIGNED_FIELDS.map((field) => `${field}=${certificate[field]}`).join('\n');
  return crypto.createHmac('sha256', config.certSecret).update(payload).digest('hex');
}

function newId() {
  return `OPS-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

/** What anyone may see when checking a certificate. */
function publicView(certificate) {
  const { userId, ...rest } = certificate;
  return { ...rest, issuer: 'OpsAcademy', algorithm: 'HMAC-SHA256' };
}

/**
 * Issue a certificate for a completed unit. Asking again returns the same one.
 */
async function issue(user, unitId) {
  const unit = units.getUnit(unitId);
  if (!unit) throw new CertificateError(`Unit '${unitId}' not found`, 404);
  if (!(await progressService.isUnitCompleted(user.id, unitId))) {
    throw new CertificateError('Complete and verify every lab step in this unit to earn its certificate', 403);
  }

  const repos = getRepos();
  const existing = await repos.certificates.getForUnit(user.id, unitId);
  if (existing) return publicView(existing);

  const certificate = {
    id: newId(),
    userId: user.id,
    studentName: user.name,
    unitId,
    unitTitle: unit.meta.title,
    score: await progressService.unitAccuracy(user.id, unitId),
    issuedAt: new Date().toISOString(),
  };
  certificate.signature = sign(certificate);
  // If two requests race, the database keeps one certificate per learner and unit.
  return publicView(await repos.certificates.create(certificate));
}

/** @returns the certificate if it exists and its signature is intact, otherwise null */
async function verify(certificateId) {
  if (typeof certificateId !== 'string' || !/^OPS-[0-9A-F]{12}$/.test(certificateId)) return null;
  const certificate = await getRepos().certificates.getById(certificateId);
  if (!certificate || !safeEqual(sign(certificate), certificate.signature)) return null;
  return publicView(certificate);
}

async function listFor(userId) {
  return (await getRepos().certificates.listForUser(userId)).map(publicView);
}

module.exports = { issue, verify, listFor, sign, CertificateError };
