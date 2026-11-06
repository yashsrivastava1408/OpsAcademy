// A Lab ID has no email, but Supabase signs people in by email. The gateway creates each Lab ID account
// under this made-up address (see server/lib/labIdentity.js); it never receives mail. Keep both in step.
export const LAB_EMAIL_DOMAIN = 'lab.opsacademy.invalid';
export const labEmail = (labId) => `${String(labId).trim().toLowerCase()}@${LAB_EMAIL_DOMAIN}`;
