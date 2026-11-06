/**
 * A small stand-in for Supabase Auth, for tests, CI and local development: no real project is ever used.
 *
 * It speaks the parts of the GoTrue API that the web app (supabase-js) and the gateway use:
 *   POST /auth/v1/signup                       anonymous guest, or email + password (confirmed at once)
 *   POST /auth/v1/token?grant_type=password    sign in
 *   POST /auth/v1/token?grant_type=refresh_token
 *   GET  /auth/v1/user, PUT /auth/v1/user      the signed-in user; adding an email and password to a guest
 *   POST /auth/v1/logout, /recover, /resend
 *   GET  /auth/v1/.well-known/jwks.json        the key the gateway verifies access tokens with (ES256)
 *   POST/PUT/DELETE /auth/v1/admin/users[/:id] what the gateway calls to make, reset and ban Lab ID accounts
 *
 *   npm run auth                                       run it by hand (port 54321, or `node test-support/fakeSupabaseAuth.js <port>`)
 *   HOST=0.0.0.0                                       listen on every interface (the Docker development stack does)
 */
const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const KID = 'fake-supabase-key';
const EXPIRES_IN = 900;

function startFakeSupabase({ port = 0, host = '127.0.0.1' } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'ES256', use: 'sig' };
  const users = new Map(); // id -> { id, email, password, anonymous, metadata, banned }
  const refreshTokens = new Map(); // token -> user id
  let baseUrl = '';

  const issuer = () => `${baseUrl}/auth/v1`;
  const find = (email) => [...users.values()].find((u) => u.email && u.email === String(email).toLowerCase());
  const publicUser = (u) => ({
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email || undefined, is_anonymous: u.anonymous,
    email_confirmed_at: u.email ? '2026-01-01T00:00:00Z' : undefined, user_metadata: u.metadata, app_metadata: { provider: u.anonymous ? 'anonymous' : 'email' },
  });

  function session(user) {
    const accessToken = jwt.sign({
      iss: issuer(), aud: 'authenticated', sub: user.id, role: 'authenticated', is_anonymous: user.anonymous,
      email: user.email || undefined, email_confirmed_at: user.email ? '2026-01-01T00:00:00Z' : undefined, user_metadata: user.metadata,
    }, privateKey, { algorithm: 'ES256', keyid: KID, expiresIn: EXPIRES_IN });
    const refreshToken = crypto.randomBytes(16).toString('hex');
    refreshTokens.set(refreshToken, user.id);
    return {
      access_token: accessToken, token_type: 'bearer', expires_in: EXPIRES_IN, expires_at: Math.floor(Date.now() / 1000) + EXPIRES_IN,
      refresh_token: refreshToken, user: publicUser(user),
    };
  }

  function userFromBearer(req) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return null;
    try {
      const claims = jwt.verify(header.slice(7), publicKey, { algorithms: ['ES256'], audience: 'authenticated' });
      return users.get(claims.sub) || null;
    } catch {
      return null;
    }
  }

  const fail = (status, code, msg) => ({ status, body: { code: status, error_code: code, msg } });

  async function route(req, url, body) {
    const path = url.pathname.replace(/^\/auth\/v1/, '');
    const method = req.method;

    if (method === 'GET' && path === '/.well-known/jwks.json') return { status: 200, body: { keys: [jwk] } };

    if (method === 'POST' && path === '/signup') {
      if (!body.email) {
        const user = { id: crypto.randomUUID(), email: null, password: null, anonymous: true, metadata: body.data || {}, banned: false };
        users.set(user.id, user);
        return { status: 200, body: session(user) };
      }
      if (find(body.email)) return fail(422, 'user_already_exists', 'User already registered');
      const user = { id: crypto.randomUUID(), email: String(body.email).toLowerCase(), password: body.password, anonymous: false, metadata: body.data || {}, banned: false };
      users.set(user.id, user);
      return { status: 200, body: session(user) };
    }

    if (method === 'POST' && path === '/token') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const user = find(body.email);
        if (!user || user.password !== body.password) return fail(400, 'invalid_credentials', 'Invalid login credentials');
        if (user.banned) return fail(400, 'user_banned', 'User is banned');
        return { status: 200, body: session(user) };
      }
      if (grant === 'refresh_token') {
        const id = refreshTokens.get(body.refresh_token);
        const user = id && users.get(id);
        if (!user || user.banned) return fail(400, 'refresh_token_not_found', 'Invalid Refresh Token');
        refreshTokens.delete(body.refresh_token); // rotated
        return { status: 200, body: session(user) };
      }
      return fail(400, 'validation_failed', 'Unsupported grant type');
    }

    if (path === '/user' && (method === 'GET' || method === 'PUT')) {
      const user = userFromBearer(req);
      if (!user) return fail(401, 'bad_jwt', 'Invalid token');
      if (method === 'PUT') {
        if (body.email) {
          if (find(body.email) && find(body.email).id !== user.id) return fail(422, 'email_exists', 'A user with this email address has already been registered');
          user.email = String(body.email).toLowerCase();
        }
        if (body.password) user.password = body.password;
        if (body.email || body.password) user.anonymous = false; // a guest became an account, same id
        if (body.data) user.metadata = { ...user.metadata, ...body.data };
      }
      return { status: 200, body: publicUser(user) };
    }

    if (method === 'POST' && path === '/logout') return { status: 204, body: null };
    if (method === 'POST' && (path === '/recover' || path === '/resend' || path === '/otp')) return { status: 200, body: {} };

    const admin = path.match(/^\/admin\/users(?:\/([^/]+))?$/);
    if (admin) {
      const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (!bearer) return fail(401, 'no_authorization', 'This endpoint requires a Bearer token');
      if (method === 'POST' && !admin[1]) {
        if (find(body.email)) return fail(422, 'email_exists', 'A user with this email address has already been registered');
        const user = { id: crypto.randomUUID(), email: String(body.email).toLowerCase(), password: body.password, anonymous: false, metadata: body.user_metadata || {}, banned: false };
        users.set(user.id, user);
        return { status: 200, body: publicUser(user) };
      }
      const user = users.get(admin[1]);
      if (!user) return fail(404, 'user_not_found', 'User not found');
      if (method === 'PUT') {
        if (body.password) user.password = body.password;
        if (body.ban_duration) user.banned = body.ban_duration !== 'none';
        return { status: 200, body: publicUser(user) };
      }
      if (method === 'DELETE') { users.delete(user.id); return { status: 200, body: {} }; }
    }
    return fail(404, 'not_found', `No route for ${method} ${path}`);
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info, x-supabase-api-version');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', async () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* an empty or odd body is treated as {} */ }
      const result = await route(req, new URL(req.url, 'http://x'), body);
      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(result.body === null ? undefined : JSON.stringify(result.body));
    });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve({
        url: baseUrl,
        users,
        close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(done); }),
      });
    });
  });
}

module.exports = { startFakeSupabase };

if (require.main === module) {
  const port = Number(process.argv[2]) || 54321;
  startFakeSupabase({ port, host: process.env.HOST || '127.0.0.1' }).then((fake) => console.log(`fake Supabase Auth listening on ${fake.url}`));
}
