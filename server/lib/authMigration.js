/**
 * One-time move of accounts from our own sign-in to Supabase Auth (ADR 0003, step 2).
 *
 * Each registered account is created in Supabase with its existing bcrypt hash, so the
 * password keeps working, and linked through `identities`; the app user id never changes.
 * Safe to re-run: linked accounts are skipped, and an address Supabase already knows is
 * reported (not overwritten).
 */

/** @param {{ createUser(user): Promise<{ id?: string, exists?: boolean }> }} supabase */
async function migrateAccounts({ repos, supabase, apply = false, log = () => {} }) {
  const users = await repos.users.listForAuthMigration();
  const report = { total: users.length, created: 0, alreadyInSupabase: [], failed: [], apply };

  for (const user of users) {
    if (!apply) {
      log(`would move ${user.email}`);
      report.created += 1;
      continue;
    }
    try {
      const result = await supabase.createUser({
        email: user.email,
        passwordHash: user.password,
        emailConfirmed: Boolean(user.emailVerified),
        name: user.name,
      });
      if (result.exists) {
        report.alreadyInSupabase.push(user.email);
        log(`${user.email}: already in Supabase, left alone (link by signing in once)`);
        continue;
      }
      await repos.identities.link({ provider: 'supabase', subject: result.id, userId: user.id });
      report.created += 1;
      log(`moved ${user.email}`);
    } catch (err) {
      report.failed.push({ email: user.email, reason: err.message });
      log(`${user.email}: FAILED ${err.message}`);
    }
  }
  return report;
}

/** The Supabase admin API (needs the secret key). */
function adminClient({ url, secretKey }) {
  const base = `${url.replace(/\/+$/, '')}/auth/v1/admin`;
  return {
    async createUser({ email, passwordHash, emailConfirmed, name }) {
      const res = await fetch(`${base}/users`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: secretKey, authorization: `Bearer ${secretKey}` },
        body: JSON.stringify({ email, password_hash: passwordHash, email_confirm: emailConfirmed, user_metadata: { name } }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 422 || res.status === 409) return { exists: true };
      if (!res.ok) throw new Error(`Supabase answered ${res.status}`);
      return { id: (await res.json()).id };
    },
  };
}

module.exports = { migrateAccounts, adminClient };
