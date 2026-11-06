/**
 * User Service — guest identities and registered accounts
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getRepos } = require('../repositories');
const { forgetIdentity } = require('../middleware/auth');

const RESET_TTL_MS = 30 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_ROUNDS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
// A guest token lasts 30 days (config.guestJwtExpiry) and is never renewed,
// so after that nobody can reach the guest's record again.
const GUEST_RETENTION_DAYS = 31;

class UserError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email || null,
    guest: Boolean(user.guest),
    emailVerified: Boolean(user.emailVerified),
    profileSlug: user.profilePublic ? user.profileSlug : null,
  };
}

// ── One-time links (password reset, email confirmation) ──────
// The link carries a random token; only its hash is stored, so reading the
// store does not let anyone use a link.

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function issueToken(userId, kind, ttlMs, now = Date.now()) {
  const token = crypto.randomBytes(32).toString('base64url');
  // A newer link replaces older ones of the same kind (done by the repository).
  await getRepos().tokens.issue({ hash: hashToken(token), userId, kind, expiresAt: now + ttlMs });
  return token;
}

/** Use a link once. @returns the user id, or null if it is unknown, expired or of another kind */
async function redeemToken(token, kind, now = Date.now()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  return getRepos().tokens.redeem(hashToken(token), kind, now);
}

function pruneExpiredTokens(now = Date.now()) {
  return getRepos().tokens.pruneExpired(now);
}

async function createGuest() {
  const id = `g_${crypto.randomBytes(9).toString('base64url')}`;
  return getRepos().users.create({
    id,
    name: `Guest-${crypto.randomBytes(2).toString('hex')}`,
    guest: true,
    createdAt: new Date().toISOString(),
  });
}

function getById(id) {
  return getRepos().users.getById(id);
}

/**
 * Make sure a verified Supabase identity has a user record. This is the only
 * place a first-time Supabase user is created (token verification stays
 * read-only). Returns the stored user.
 */
async function ensureSupabaseUser(identity) {
  const repos = getRepos();
  const email = identity.email ? identity.email.toLowerCase() : null;
  const linked = Boolean(identity.subject); // the token's Supabase id maps to an existing app user

  let user = await repos.users.getById(identity.id);

  // An account from the old sign-in, now reached through Supabase: same confirmed address, so same person.
  if (!user && identity.emailVerified && email) {
    const legacy = await repos.users.getByEmail(email);
    if (legacy && !legacy.guest) {
      await repos.identities.link({ provider: 'supabase', subject: identity.id, userId: legacy.id });
      forgetIdentity(identity.id);
      user = legacy.emailVerified ? legacy : await repos.users.update(legacy.id, { emailVerified: true });
    }
  }

  if (!user) {
    user = await repos.users.createIfAbsent({
      id: identity.id,
      name: identity.name,
      email,
      guest: Boolean(identity.guest),
      emailVerified: Boolean(identity.emailVerified),
      createdAt: new Date().toISOString(),
    });
  } else if (user.guest && !identity.guest && email && !linked) {
    // A guest (anonymous Supabase user) who has added and confirmed an email: same id, so progress carries over.
    user = await repos.users.update(user.id, {
      guest: false, name: identity.name, email, emailVerified: Boolean(identity.emailVerified), registeredAt: new Date().toISOString(),
    });
  } else if (!user.emailVerified && identity.emailVerified && email && user.email === email) {
    user = await repos.users.update(user.id, { emailVerified: true });
  }
  await claimInvites(user);
  return user;
}

/** Apply college invites addressed to a verified email (see collegeService.importRoster). */
async function claimInvites(user) {
  if (user && !user.guest && user.emailVerified && user.email) {
    await getRepos().invites.claim(user.id, user.email);
  }
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
    throw new UserError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

function validate({ name, email, password }) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
    throw new UserError('Name is required (up to 80 characters)');
  }
  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim()) || email.length > 254) {
    throw new UserError('A valid email address is required');
  }
  validatePassword(password);
}

/**
 * Create an account. If the caller is already a guest, that guest record is
 * upgraded in place so the progress they earned as a guest is kept.
 */
async function register({ name, email, password }, guestId = null) {
  validate({ name, email, password });
  const repos = getRepos();
  const normalizedEmail = email.toLowerCase().trim();

  if (await repos.users.getByEmail(normalizedEmail)) {
    throw new UserError('User with this email already exists');
  }

  const existingGuest = guestId ? await repos.users.getById(guestId) : null;
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const fields = {
    name: name.trim(),
    email: normalizedEmail,
    password: passwordHash,
    guest: false,
    emailVerified: false,
    registeredAt: new Date().toISOString(),
  };

  try {
    if (existingGuest && existingGuest.guest) {
      return await repos.users.update(existingGuest.id, fields);
    }
    return await repos.users.create({
      id: `u_${crypto.randomBytes(9).toString('base64url')}`,
      createdAt: new Date().toISOString(),
      ...fields,
    });
  } catch (err) {
    // Two sign-ups racing for one address: the database's unique index decides.
    if (err.code === 'email_taken') throw new UserError('User with this email already exists');
    throw err;
  }
}

// Compared against when the email is unknown, so both failure paths cost one bcrypt check.
const DUMMY_HASH = bcrypt.hashSync('opsacademy-timing-equaliser', BCRYPT_ROUNDS);

async function login({ email, password }) {
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw new UserError('Email and password are required');
  }
  const user = await getRepos().users.getByEmail(email.toLowerCase().trim());

  const matches = await bcrypt.compare(password, user && user.password ? user.password : DUMMY_HASH);
  if (!user || !matches) throw new UserError('Invalid email or password', 401);
  return user;
}

// ── Password reset and email confirmation ────────────────────

/**
 * Start a password reset.
 * @returns {{ user: object, token: string } | null} null when no account has this
 *   email; the caller must answer the same way in both cases.
 */
async function requestPasswordReset(email, now = Date.now()) {
  if (typeof email !== 'string') return null;
  const user = await getRepos().users.getByEmail(email.toLowerCase().trim());
  if (!user) return null;
  return { user, token: await issueToken(user.id, 'reset', RESET_TTL_MS, now) };
}

/**
 * Finish a password reset with the token from the emailed link. Every
 * session started before this moment stops working (see middleware/auth.js).
 */
async function resetPassword(token, newPassword, now = Date.now()) {
  validatePassword(newPassword);
  const repos = getRepos();
  const userId = await redeemToken(token, 'reset', now);
  const user = userId ? await repos.users.getById(userId) : null;
  if (!user) throw new UserError('This reset link is invalid or has expired. Ask for a new one.', 400);

  return repos.users.update(user.id, {
    password: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
    // Whole seconds, because that is the precision of a token's issue time.
    passwordChangedAt: Math.floor(now / 1000) * 1000,
    // Opening the link proves the address is theirs.
    emailVerified: true,
  });
}

/** A link that confirms the account's email address. */
function createEmailVerification(userId, now = Date.now()) {
  return issueToken(userId, 'verify', VERIFY_TTL_MS, now);
}

async function verifyEmail(token, now = Date.now()) {
  const repos = getRepos();
  const userId = await redeemToken(token, 'verify', now);
  const user = userId ? await repos.users.getById(userId) : null;
  if (!user) throw new UserError('This confirmation link is invalid or has expired.', 400);
  const verified = await repos.users.update(user.id, { emailVerified: true });
  await claimInvites(verified);
  return verified;
}

// ── Public profile ───────────────────────────────────────────

function slugify(name) {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return `${base || 'learner'}-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Turn the shareable profile page on or off. The address is made once and
 * kept, so a link that was shared works again if the profile is re-enabled.
 */
async function setProfilePublic(userId, isPublic) {
  const repos = getRepos();
  const user = await repos.users.getById(userId);
  if (!user || user.guest) throw new UserError('Create an account to have a profile page', 403);

  const patch = { profilePublic: Boolean(isPublic) };
  if (patch.profilePublic && !user.profileSlug) {
    // The slug has a random suffix; a clash is possible but rare, so retry a few times.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await repos.users.update(user.id, { ...patch, profileSlug: slugify(user.name) });
      } catch (err) {
        if (err.code !== 'slug_taken' || attempt >= 4) throw err;
      }
    }
  }
  return repos.users.update(user.id, patch);
}

/** @returns the user behind a profile address, only while their profile is public */
async function getByProfileSlug(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{3,48}$/.test(slug)) return null;
  const user = await getRepos().users.getBySlug(slug);
  return user && user.profilePublic && user.profileSlug === slug ? user : null;
}

function counts() {
  return getRepos().users.counts();
}

/**
 * Delete guests whose token has expired, with their progress. Every visitor
 * gets a guest record, so without this the table only ever grows.
 * @returns {Promise<number>} how many guests were removed
 */
function pruneExpiredGuests(now = Date.now()) {
  return getRepos().users.pruneGuests(now - GUEST_RETENTION_DAYS * DAY_MS);
}

module.exports = {
  createGuest,
  getById,
  ensureSupabaseUser,
  register,
  login,
  publicUser,
  requestPasswordReset,
  resetPassword,
  createEmailVerification,
  verifyEmail,
  setProfilePublic,
  getByProfileSlug,
  counts,
  pruneExpiredGuests,
  pruneExpiredTokens,
  UserError,
};
