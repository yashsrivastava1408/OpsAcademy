/**
 * User Service — guest identities and registered accounts
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getStore } = require('../lib/store');
const progressService = require('./progressService');

const USERS = 'users';
const EMAILS = 'emails';
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
  return { id: user.id, name: user.name, email: user.email || null, guest: Boolean(user.guest) };
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

function validate({ name, email, password }) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
    throw new UserError('Name is required (up to 80 characters)');
  }
  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim()) || email.length > 254) {
    throw new UserError('A valid email address is required');
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
    throw new UserError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
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

module.exports = { createGuest, getById, register, login, publicUser, pruneExpiredGuests, UserError };
