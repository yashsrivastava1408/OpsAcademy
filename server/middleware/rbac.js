/**
 * Role-based access control (ADR 0003).
 *
 * Roles live in `memberships`, never in the token, so a change applies within
 * a few seconds and a user cannot grant themselves anything by editing their
 * own profile. Hierarchy: platform_admin passes every check.
 */

const config = require('../config');
const { getRepos } = require('../repositories');
const { requireAuth } = require('./auth');

const ROLES = ['student', 'trainer', 'placement_officer', 'college_admin', 'platform_admin'];
const ACCESS_TTL_MS = 5000;
const caches = new WeakMap(); // repositories -> Map<userId, { value, at }>

function cache() {
  const repos = getRepos();
  let map = caches.get(repos);
  if (!map) {
    map = new Map();
    caches.set(repos, map);
  }
  return map;
}

/** Forget what is cached about a user (after their roles change). */
function forgetAccess(userId) {
  cache().delete(userId);
}

/**
 * What a signed-in user may do: their memberships, roles and colleges.
 * A verified email listed in PLATFORM_ADMIN_EMAILS is a platform admin, which
 * is how the first operator is bootstrapped.
 */
async function loadAccess(user) {
  const map = cache();
  const hit = map.get(user.id);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.value;

  const repos = getRepos();
  const memberships = user.guest ? [] : await repos.memberships.forUser(user.id);
  const roles = new Set(memberships.map((m) => m.role));

  // The stored record decides: a token's claims are not enough, and legacy tokens carry none.
  const stored = user.guest ? null : await repos.users.getById(user.id);
  if (stored && config.platformAdminEmails.length > 0 && stored.emailVerified && stored.email
    && config.platformAdminEmails.includes(stored.email.toLowerCase())) {
    roles.add('platform_admin');
  }

  const collegeIds = [...new Set(memberships.map((m) => m.collegeId).filter(Boolean))];
  const value = {
    memberships, roles: [...roles], collegeIds, collegeId: collegeIds[0] || null,
    labAccess: Boolean(stored && stored.labAccess), disabled: Boolean(stored && stored.disabled), username: stored ? stored.username || null : null,
  };
  if (map.size > 5000) map.clear();
  map.set(user.id, { value, at: Date.now() });
  return value;
}

function hasRole(access, allowed) {
  return access.roles.includes('platform_admin') || allowed.some((role) => access.roles.includes(role));
}

/**
 * Allow the request only for users holding one of `roles` (platform admins always pass).
 * Sets req.user.roles, req.user.collegeId and req.user.collegeIds.
 */
function requireRole(...allowed) {
  for (const role of allowed) {
    if (!ROLES.includes(role)) throw new Error(`Unknown role: ${role}`);
  }
  const check = async (req, res, next) => {
    try {
      const access = await loadAccess(req.user);
      Object.assign(req.user, { roles: access.roles, collegeId: access.collegeId, collegeIds: access.collegeIds });
      if (!hasRole(access, allowed)) {
        return res.status(403).json({ success: false, error: 'Forbidden: your role cannot do this' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
  return [requireAuth, check];
}

/**
 * Allow the request only for members of the college named in `req.params.collegeId`
 * who hold one of `roles` there (platform admins pass for every college).
 * A caller who is not a member at all gets 404, so the endpoint does not confirm
 * which colleges exist; a member without the role gets 403.
 */
function requireCollegeRole(...allowed) {
  const check = async (req, res, next) => {
    try {
      const access = await loadAccess(req.user);
      Object.assign(req.user, { roles: access.roles, collegeId: access.collegeId, collegeIds: access.collegeIds });
      if (access.roles.includes('platform_admin')) return next();
      const mine = access.memberships.filter((m) => m.collegeId === req.params.collegeId);
      if (mine.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
      if (!mine.some((m) => allowed.includes(m.role))) {
        return res.status(403).json({ success: false, error: 'Forbidden: your role cannot do this' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
  return [requireAuth, check];
}

/** Operator-only endpoints: platform admins. */
const requireAdmin = requireRole('platform_admin');

module.exports = { ROLES, requireRole, requireCollegeRole, requireAdmin, loadAccess, forgetAccess, hasRole };
