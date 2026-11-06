# ADR 0004: Talhelix single sign-on and identity linking (discovery and design)

Status: proposed (Phase 2, issue #96). Nothing here is built yet; it records what we need to learn
from the Talhelix side and the design we will follow once we know.

## Context

Colleges that use Talhelix (the TalenciaGlobal reporting product) should not make students keep a
second password, and Talhelix wants lab results against the same student (P6-05). OpsAcademy's only
identity system is Supabase Auth (ADR 0003), and users are linked to Supabase users through
`public.identities (provider, subject, user_id)`.

We do not yet know how Talhelix identifies a student. The design below works for each likely case.

## Questions for the Talhelix team (blockers for build)

1. Does Talhelix already sign users in with an identity provider (OIDC / SAML / Supabase / Auth0 / own)?
2. What is the stable student identifier (a UUID, a roll number, an email)? Is the email verified?
3. Can Talhelix act as an OIDC provider, or can we receive a signed token from it?
4. Which fields can we trust for the college (a tenant id) and the section?
5. Do students ever exist in Talhelix without an email, and may two students share one?

## Options

| Option | How it works | Fits when |
| --- | --- | --- |
| A. Talhelix is an OIDC provider | Supabase "Custom OIDC" provider (or a SAML provider on a paid plan); students press "Continue with Talhelix". | Talhelix can issue OIDC tokens. Preferred: no custom code. |
| B. Shared Supabase project | Talhelix and OpsAcademy use the same Supabase Auth; one user, two apps. | Talhelix is already on Supabase, with its own tables. |
| C. Signed hand-off token | Talhelix redirects with a short-lived, signed token; a gateway endpoint verifies it and mints a Supabase session (admin API `generateLink`). | Talhelix has its own accounts and cannot be an OIDC provider. Needs a shared signing key and replay protection. |

**Default plan: A, then C if A is not possible.** B only if Talhelix already runs on the same project.

## Identity linking rules (all options)

- A Talhelix student is linked by **verified email** first (the rule `ensureSupabaseUser` already uses for migrated
  accounts), and the Talhelix id is stored as a second row in `identities` (`provider = 'talhelix'`, `subject = <their id>`).
  The `provider` check constraint in migration 0002 must be widened in the build migration.
- An email that is not verified on the Talhelix side never links to an existing account.
- If a Talhelix id is already linked to a different OpsAcademy user, the sign-in is refused and an administrator is told
  (audit log entry `identity.conflict`); we never merge two accounts automatically.
- College and section come from the Talhelix token and are applied as `memberships`, only when the college is
  already onboarded (P2-09). Unknown colleges are rejected, not created.
- Roles are never taken from the Talhelix token. A trainer or admin role is granted inside OpsAcademy (ADR 0003, section 3).

## Sign-out and sessions

Signing out of OpsAcademy ends only the OpsAcademy session. Single logout across both products is out of scope until
Talhelix supports back-channel logout.

## Data we send back (P6-05, later)

Lab results flow to Talhelix keyed by the linked Talhelix id, over a server-to-server call authenticated with a
per-college key. Designed in that issue, not here.

## Next step

Answer the five questions above; then pick A, B or C and open a build issue with the chosen option, the
widened `identities` constraint and the test plan (account linking, conflict, unverified email).
