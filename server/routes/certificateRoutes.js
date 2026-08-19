/**
 * Certificate Routes — Cryptographically Signed Certificate Generation & Public Verification API
 */

const express = require('express');
const crypto = require('crypto');
const config = require('../config');

const router = express.Router();

// Memory/Disk certificate registry store (In production synced to MongoDB)
const certificateRegistry = new Map();

/**
 * Helper: Generate SHA-256 Cryptographic Signature for Certificate
 */
function generateCertHash(studentName, unitId, issuedAt) {
  const secret = config.jwtSecret || 'opsacademy-secret';
  const data = `${studentName.toLowerCase().trim()}:${unitId}:${issuedAt}:${secret}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * POST /api/certificates/generate
 * Issue a cryptographically signed placement certificate
 * Body: { studentName, unitId, score? }
 */
router.post('/generate', (req, res, next) => {
  try {
    const { studentName = 'Student Developer', unitId = 'general-devops', score = 100 } = req.body;
    const issuedAt = new Date().toISOString();

    const certHash = generateCertHash(studentName, unitId, issuedAt);

    const certificate = {
      certHash,
      studentName,
      unitId,
      score,
      issuedAt,
      issuer: 'OpsAcademy Placement Verification Authority',
      algorithm: 'SHA-256',
      verified: true,
      verificationUrl: `/api/certificates/verify/${certHash}`,
    };

    certificateRegistry.set(certHash, certificate);
    console.log(`[Certificate API] Issued certificate ${certHash.slice(0, 12)} for ${studentName}`);

    res.status(201).json({
      success: true,
      data: certificate,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/certificates/verify/:certHash
 * Public validation endpoint to authenticate certificate SHA-256 hash
 */
router.get('/verify/:certHash', (req, res) => {
  const { certHash } = req.params;
  const certificate = certificateRegistry.get(certHash);

  if (!certificate) {
    return res.status(404).json({
      success: false,
      verified: false,
      error: 'Invalid or unverified certificate signature hash',
    });
  }

  res.json({
    success: true,
    verified: true,
    data: certificate,
  });
});

module.exports = router;
