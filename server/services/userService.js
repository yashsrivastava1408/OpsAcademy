/**
 * User Service — the learner record behind a Supabase identity, and the public profile.
 * Passwords, guests' sessions and email links are Supabase Auth's job; this keeps only what the app owns.
 */

const crypto = require('crypto');
const { getRepos } = require('../repositories');
const { forgetIdentity } = require('../middleware/auth');
const labIdentity = require('../lib/labIdentity');

const DAY_MS = 24 * 60 * 60 * 1000;
// A guest who has not been seen for this long (and has no account) is removed with their progress.
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
    username: user.username || null,
    labAccess: Boolean(user.labAccess),
  };
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

  // The token cannot be trusted to say the address is confirmed (see labIdentity.emailConfirmed), so unless the
  // stored record already says so, Supabase is asked once; the answer is stored, so later requests do not ask.
  let verified = Boolean(identity.emailVerified);
  // (A Lab ID's made-up address has no inbox and no stored email, so there is nothing to confirm.)
  if (!verified && email && !identity.guest && !email.endsWith(`@${labIdentity.LAB_EMAIL_DOMAIN}`)) {
    if (user && user.emailVerified && user.email === email) verified = true;
    else if (labIdentity.configured()) verified = await labIdentity.emailConfirmed(identity.subject || identity.id);
  }

  // The same confirmed address already has an account here (its Supabase user was re-created, say): same person,
  // so the new Supabase identity is linked to the existing account instead of starting an empty one.
  if (!user && verified && email) {
    const existing = await repos.users.getByEmail(email);
    if (existing && !existing.guest) {
      await repos.identities.link({ provider: 'supabase', subject: identity.id, userId: existing.id });
      forgetIdentity(identity.id);
      user = existing.emailVerified ? existing : await repos.users.update(existing.id, { emailVerified: true });
    }
  }

  if (!user) {
    user = await repos.users.createIfAbsent({
      id: identity.id,
      name: identity.name,
      email,
      guest: Boolean(identity.guest),
      emailVerified: verified,
      createdAt: new Date().toISOString(),
    });
  } else if (user.guest && !identity.guest && email && !linked) {
    // A guest (anonymous Supabase user) who has added and confirmed an email: same id, so progress carries over.
    user = await repos.users.update(user.id, {
      guest: false, name: identity.name, email, emailVerified: verified, registeredAt: new Date().toISOString(),
    });
  } else if (!user.emailVerified && verified && email && user.email === email) {
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
  getById,
  ensureSupabaseUser,
  publicUser,
  setProfilePublic,
  getByProfileSlug,
  counts,
  pruneExpiredGuests,
  UserError,
};
