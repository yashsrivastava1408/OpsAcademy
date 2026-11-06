/**
 * Lab accounts: an ID and a password issued by the platform admin, one per student, no email.
 * Passwords are shown once, when generated or reset; only a hash is stored.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getRepos } = require('../repositories');

class LabAccountError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const BCRYPT_ROUNDS = 10;
const MAX_PER_REQUEST = 100;
const PASSWORD_LENGTH = 12;
// No 0/O, 1/l/I: an ID and password read off a printed sheet must not be misread.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const PREFIX = /^[a-z0-9][a-z0-9-]{1,24}$/;

/** An unbiased random password (rejection sampling, so every character is equally likely). */
function generatePassword(length = PASSWORD_LENGTH) {
  const limit = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length * 2)) {
      if (byte < limit && out.length < length) out += ALPHABET[byte % ALPHABET.length];
    }
  }
  return out;
}

const publicLab = (u) => ({
  id: u.id, username: u.username, name: u.name, disabled: Boolean(u.disabled), labAccess: Boolean(u.labAccess),
  createdAt: u.createdAt, lastPasswordChangeAt: u.passwordChangedAt || null,
});

/**
 * Make `count` accounts named `prefix-0001`, `prefix-0002`, ... (continuing after the highest one that exists),
 * or one per entry of `names`. @returns [{ id, username, name, password }] with the passwords in the clear, once.
 */
async function generate({ prefix, count, names }) {
  const clean = typeof prefix === 'string' ? prefix.trim().toLowerCase() : '';
  if (!PREFIX.test(clean)) throw new LabAccountError('Prefix must be 2 to 25 letters, digits or hyphens, for example srm-cse');
  let list = null;
  if (names !== undefined) {
    if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) throw new LabAccountError('names must be a list of text');
    list = names.map((n) => n.trim().slice(0, 80)).filter(Boolean);
  }
  const total = list ? list.length : Number(count);
  if (!Number.isInteger(total) || total < 1 || total > MAX_PER_REQUEST) throw new LabAccountError(`Make between 1 and ${MAX_PER_REQUEST} accounts at a time`);

  const repos = getRepos();
  let next = (await repos.users.maxUsernameSequence(clean)) + 1;
  const made = [];
  for (let i = 0; i < total; i += 1) {
    const password = generatePassword();
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    for (let attempt = 0; ; attempt += 1) {
      const username = `${clean}-${String(next).padStart(4, '0')}`;
      next += 1;
      try {
        const user = await repos.users.create({
          id: `u_${crypto.randomBytes(9).toString('base64url')}`,
          name: list ? list[i] : username,
          username,
          password: hash,
          guest: false,
          emailVerified: false,
          labAccess: true,
          createdAt: new Date().toISOString(),
          registeredAt: new Date().toISOString(),
        });
        made.push({ id: user.id, username, name: user.name, password });
        break;
      } catch (err) {
        if (err.code !== 'username_taken' || attempt > 5) throw err; // another admin request took that number: try the next
      }
    }
  }
  return made;
}

async function list({ search = '', limit = 50, offset = 0 } = {}) {
  const max = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const { total, rows } = await getRepos().users.listLabAccounts({ search: String(search).slice(0, 60), limit: max, offset: Math.max(Number(offset) || 0, 0) });
  return { total, accounts: rows.map(publicLab) };
}

async function labAccountOrThrow(id) {
  const user = await getRepos().users.getById(id);
  if (!user || !user.username) throw new LabAccountError('Not found', 404);
  return user;
}

/** A new password, shown once. The old one stops working at once, and so does any signed-in session. */
async function resetPassword(id) {
  const user = await labAccountOrThrow(id);
  const password = generatePassword();
  await getRepos().users.update(user.id, { password: await bcrypt.hash(password, BCRYPT_ROUNDS), passwordChangedAt: Date.now() });
  return { id: user.id, username: user.username, name: user.name, password };
}

/** Switch an account off or on. Switching off also ends its signed-in sessions (the caller ends its sandboxes). */
async function setDisabled(id, disabled) {
  const user = await labAccountOrThrow(id);
  const patch = { disabled: Boolean(disabled) };
  if (disabled) patch.passwordChangedAt = Date.now();
  return publicLab(await getRepos().users.update(user.id, patch));
}

module.exports = { LabAccountError, generate, list, resetPassword, setDisabled, generatePassword, MAX_PER_REQUEST };
