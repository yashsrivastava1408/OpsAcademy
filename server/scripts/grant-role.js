#!/usr/bin/env node
/**
 * Give someone a role (or take it away). Roles live in the database, so this is
 * how the first platform admin and the first college admins are set up.
 *
 *   node scripts/grant-role.js ada@example.com platform_admin
 *   node scripts/grant-role.js ada@example.com college_admin --college <college id or slug>
 *   node scripts/grant-role.js ada@example.com trainer --college srm --revoke
 *
 * The person must already have signed in once (so an account exists). Uses
 * DATABASE_URL like the gateway; the action is written to the audit log.
 */
require('dotenv').config({ quiet: true });
const { getRepos } = require('../repositories');
const { ROLES } = require('../middleware/rbac');
const audit = require('../services/auditService');

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const [email, role] = process.argv.slice(2);
  const revoke = process.argv.includes('--revoke');
  const collegeRef = argValue('--college');
  if (!email || !ROLES.includes(role)) {
    console.error(`Usage: node scripts/grant-role.js <email> <${ROLES.join('|')}> [--college <id or slug>] [--revoke]`);
    process.exit(2);
  }
  if ((role === 'platform_admin') === Boolean(collegeRef)) {
    console.error(role === 'platform_admin' ? 'A platform admin belongs to no college: drop --college.' : `The ${role} role needs --college.`);
    process.exit(2);
  }

  const repos = getRepos();
  try {
    const user = await repos.users.getByEmail(email.trim().toLowerCase());
    if (!user) throw new Error(`No account with email ${email}. Ask them to sign in once first.`);
    let college = null;
    if (collegeRef) {
      college = (await repos.colleges.getById(collegeRef)) || (await repos.colleges.getBySlug(collegeRef));
      if (!college) throw new Error(`No college "${collegeRef}".`);
    }
    const collegeId = college ? college.id : null;
    const has = (await repos.memberships.forUser(user.id)).some((m) => m.role === role && m.collegeId === collegeId);

    if (revoke) {
      if (has) await repos.memberships.remove({ userId: user.id, collegeId, role });
      console.log(has ? `Removed ${role} from ${email}.` : `${email} did not have ${role}.`);
    } else if (has) {
      console.log(`${email} already has ${role}.`);
    } else {
      await repos.memberships.add({ userId: user.id, collegeId, role });
      console.log(`Granted ${role} to ${email}${college ? ` at ${college.name}` : ''}.`);
    }
    await audit.record(null, revoke ? 'role.revoke' : 'role.grant', { entityType: 'user', entityId: user.id, collegeId, meta: { role, via: 'cli' } });
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await repos.close();
  }
}

main();
