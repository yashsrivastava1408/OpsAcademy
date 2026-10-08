/**
 * User Service — guest identities and registered accounts
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getStore } = require('../lib/store');
const progressService = require('./progressService');

const USERS = 'users';
const EMAILS = 'emails';
const TOKENS = 'tokens';
const PROFILES = 'profiles';
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

function issueToken(userId, kind, ttlMs, now = Date.now()) {
  const store = getStore();
  // A newer link replaces older ones of the same kind.
  for (const entry of store.find(TOKENS, (t) => t.userId === userId && t.kind === kind)) store.delete(TOKENS, entry.hash);
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = hashToken(token);
  store.set(TOKENS, hash, { hash, userId, kind, expiresAt: now + ttlMs });
  return token;
}

/** Use a link once. @returns the user id, or null if it is unknown, expired or of another kind */
function redeemToken(token, kind, now = Date.now()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const store = getStore();
  const entry = store.get(TOKENS, hashToken(token));
  if (!entry || entry.kind !== kind) return null;
  store.delete(TOKENS, entry.hash);
  return entry.expiresAt > now ? entry.userId : null;
}

function pruneExpiredTokens(now = Date.now()) {
  const store = getStore();
  let removed = 0;
  for (const entry of store.find(TOKENS, (t) => t.expiresAt <= now)) {
    store.delete(TOKENS, entry.hash);
    removed += 1;
  }
  return removed;
}

function createGuest() {
  const id = `g_${crypto.randomBytes(9).toString('base64url')}`;
  const user = {
    id,
    name: `Guest-${crypto.randomBytes(2).toString('hex')}`,
    guest: true,
    createdAt: new Date().toISOString(),
  };
  getStore().set(USERS, id, user);
  return user;
}

function getById(id) {
  return getStore().get(USERS, id);
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
  const store = getStore();
  const normalizedEmail = email.toLowerCase().trim();

  if (store.get(EMAILS, normalizedEmail)) {
    throw new UserError('User with this email already exists');
  }

  const existingGuest = guestId ? store.get(USERS, guestId) : null;
  const base = existingGuest && existingGuest.guest
    ? existingGuest
    : { id: `u_${crypto.randomBytes(9).toString('base64url')}`, createdAt: new Date().toISOString() };

  const user = {
    ...base,
    name: name.trim(),
    email: normalizedEmail,
    password: await bcrypt.hash(password, BCRYPT_ROUNDS),
    guest: false,
    emailVerified: false,
    registeredAt: new Date().toISOString(),
  };

  store.set(USERS, user.id, user);
  store.set(EMAILS, normalizedEmail, { id: user.id });
  return user;
}

// Compared against when the email is unknown, so both failure paths cost one bcrypt check.
const DUMMY_HASH = bcrypt.hashSync('opsacademy-timing-equaliser', BCRYPT_ROUNDS);

async function login({ email, password }) {
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw new UserError('Email and password are required');
  }
  const store = getStore();
  const ref = store.get(EMAILS, email.toLowerCase().trim());
  const user = ref ? store.get(USERS, ref.id) : null;

  const matches = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
  if (!user || !matches) throw new UserError('Invalid email or password', 401);
  return user;
}

// ── Password reset and email confirmation ────────────────────

/**
 * Start a password reset.
 * @returns {{ user: object, token: string } | null} null when no account has this
 *   email; the caller must answer the same way in both cases.
 */
function requestPasswordReset(email, now = Date.now()) {
  if (typeof email !== 'string') return null;
  const store = getStore();
  const ref = store.get(EMAILS, email.toLowerCase().trim());
  const user = ref ? store.get(USERS, ref.id) : null;
  if (!user) return null;
  return { user, token: issueToken(user.id, 'reset', RESET_TTL_MS, now) };
}

/**
 * Finish a password reset with the token from the emailed link. Every
 * session started before this moment stops working (see middleware/auth.js).
 */
async function resetPassword(token, newPassword, now = Date.now()) {
  validatePassword(newPassword);
  const store = getStore();
  const userId = redeemToken(token, 'reset', now);
  const user = userId ? store.get(USERS, userId) : null;
  if (!user) throw new UserError('This reset link is invalid or has expired. Ask for a new one.', 400);

  const updated = {
    ...user,
    password: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
    // Whole seconds, because that is the precision of a token's issue time.
    passwordChangedAt: Math.floor(now / 1000) * 1000,
    // Opening the link proves the address is theirs.
    emailVerified: true,
  };
  store.set(USERS, user.id, updated);
  return updated;
}

/** A link that confirms the account's email address. */
function createEmailVerification(userId, now = Date.now()) {
  return issueToken(userId, 'verify', VERIFY_TTL_MS, now);
}

function verifyEmail(token, now = Date.now()) {
  const store = getStore();
  const userId = redeemToken(token, 'verify', now);
  const user = userId ? store.get(USERS, userId) : null;
  if (!user) throw new UserError('This confirmation link is invalid or has expired.', 400);
  const updated = { ...user, emailVerified: true };
  store.set(USERS, user.id, updated);
  return updated;
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
function setProfilePublic(userId, isPublic) {
  const store = getStore();
  const user = store.get(USERS, userId);
  if (!user || user.guest) throw new UserError('Create an account to have a profile page', 403);

  const updated = { ...user, profilePublic: Boolean(isPublic) };
  if (updated.profilePublic && !updated.profileSlug) {
    updated.profileSlug = slugify(user.name);
    store.set(PROFILES, updated.profileSlug, { id: user.id });
  }
  store.set(USERS, user.id, updated);
  return updated;
}

/** @returns the user behind a profile address, only while their profile is public */
function getByProfileSlug(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{3,48}$/.test(slug)) return null;
  const store = getStore();
  const ref = store.get(PROFILES, slug);
  const user = ref ? store.get(USERS, ref.id) : null;
  return user && user.profilePublic && user.profileSlug === slug ? user : null;
}

function counts() {
  const users = getStore().all(USERS);
  const guests = users.filter((u) => u.guest).length;
  return { registered: users.length - guests, guests };
}

/**
 * Delete guests whose token has expired, with their progress. Every visitor
 * gets a guest record, so without this the store only ever grows.
 * @returns {number} how many guests were removed
 */
function pruneExpiredGuests(now = Date.now()) {
  const store = getStore();
  const cutoff = now - GUEST_RETENTION_DAYS * DAY_MS;
  let removed = 0;
  for (const user of store.all(USERS)) {
    if (!user.guest || !(Date.parse(user.createdAt) < cutoff)) continue;
    store.delete(USERS, user.id);
    progressService.remove(user.id);
    removed += 1;
  }
  return removed;
}

module.exports = {
  createGuest,
  getById,
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
