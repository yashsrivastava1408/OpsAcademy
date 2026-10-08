import { useCallback, useState } from 'react';
import { Activity, Loader, RefreshCw, Square } from 'lucide-react';
import { adminApi, errorMessage } from '../services/api';
import usePolling from '../hooks/usePolling';
import './AuthPage.css';
import './ExtraPages.css';

const TOKEN_KEY = 'opsacademy_admin_token';
const REFRESH_MS = 10000;

const minutes = (ms) => `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
const yesNo = (value) => (value ? 'yes' : 'no');

/**
 * Operator page. It needs the server's ADMIN_TOKEN, which is kept only for
 * this browser tab (sessionStorage) and sent as a header; the endpoints do
 * not exist at all on a server that has no ADMIN_TOKEN set.
 */
export default function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [draft, setDraft] = useState('');
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await adminApi.overview(token);
      setOverview(res.data.data);
      setError(null);
    } catch (err) {
      setOverview(null);
      if (err.response?.status === 404) setError('Operator access is switched off on this server (no ADMIN_TOKEN is set).');
      else if (err.response?.status === 403) setError('That token was not accepted.');
      else setError(errorMessage(err, 'The server did not respond.'));
    }
  }, [token]);

  usePolling(load, REFRESH_MS, Boolean(token));

  const signIn = (e) => {
    e.preventDefault();
    sessionStorage.setItem(TOKEN_KEY, draft.trim());
    setToken(draft.trim());
    setDraft('');
  };

  const signOut = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken('');
    setOverview(null);
    setError(null);
  };

  const act = async (action) => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  if (!token || (error && !overview)) {
    return (
      <div className="auth-page">
        <form className="auth-card glass-card" onSubmit={signIn}>
          <h1 className="auth-title"><Activity size={18} /> Operator access</h1>
          <p className="auth-lead">Enter the ADMIN_TOKEN this server was started with.</p>
          <label className="auth-field">
            <span>Admin token</span>
            <input className="input" type="password" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" required />
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary auth-submit">Open</button>
        </form>
      </div>
    );
  }

  if (!overview) {
    return <div className="page-loading"><Loader size={32} className="spin" /></div>;
  }

  const { sandbox, sandboxes, users, progress, services, limits } = overview;
  return (
    <div className="admin-page">
      <div className="container">
        <div className="admin-header">
          <h1><Activity size={20} /> Operator overview</h1>
          <div className="admin-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => act(() => adminApi.refillPool(token))} disabled={busy}>
              <RefreshCw size={14} /> Refill pool
            </button>
            <button className="btn btn-ghost btn-sm" onClick={signOut}>Lock</button>
          </div>
        </div>
        {error && <p className="auth-error" role="alert">{error}</p>}

        <div className="admin-tiles">
          <div className="admin-tile glass-card"><strong>{sandbox.activeSessions} / {sandbox.capacity}</strong><span>sandboxes in use ({sandbox.mode})</span></div>
          <div className="admin-tile glass-card"><strong>{sandbox.pool.available} / {sandbox.pool.targetSize}</strong><span>pre-warmed and waiting</span></div>
          <div className="admin-tile glass-card"><strong>{users.registered}</strong><span>accounts, plus {users.guests} guests</span></div>
          <div className="admin-tile glass-card"><strong>{progress.learnersWithXp}</strong><span>learners with XP ({progress.totalXp} XP in total)</span></div>
          <div className="admin-tile glass-card"><strong>{overview.certificates}</strong><span>certificates issued</span></div>
          <div className="admin-tile glass-card"><strong>{minutes(overview.uptimeSeconds * 1000)}</strong><span>gateway uptime</span></div>
        </div>

        <section className="admin-section glass-card">
          <h2>Services</h2>
          <dl className="admin-facts">
            <dt>AI hub reachable</dt><dd className={services.aiHub ? 'ok' : 'bad'}>{yesNo(services.aiHub)}</dd>
            <dt>Store</dt><dd className={services.storeWritable ? 'ok' : 'bad'}>{services.storeDriver}, {services.storeWritable ? 'writable' : 'NOT writable'}</dd>
            <dt>Email is delivered</dt><dd className={services.emailDelivers ? 'ok' : ''}>{services.emailDelivers ? 'yes' : 'no (links go to the server log)'}</dd>
            <dt>Sandbox start time</dt>
            <dd>
              pool p50 {sandbox.claimLatencyMs.pool.p50 ?? 'n/a'} ms ({sandbox.claimLatencyMs.pool.samples} samples),
              cold p50 {sandbox.claimLatencyMs.cold.p50 ?? 'n/a'} ms ({sandbox.claimLatencyMs.cold.samples} samples)
            </dd>
            <dt>Limits</dt>
            <dd>{limits.maxPerUser} per learner, {limits.maxTotal} in total, {limits.maxSessionMinutes} min per session, closed after {limits.maxInactivityMinutes} idle min</dd>
          </dl>
        </section>

        <section className="admin-section glass-card">
          <h2>Running sandboxes ({sandboxes.length})</h2>
          {sandboxes.length === 0 ? (
            <p className="profile-empty">No sandbox is running.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>Lab</th><th>Owner</th><th>Running for</th><th>Idle for</th><th>Start</th><th></th></tr>
                </thead>
                <tbody>
                  {sandboxes.map((s) => (
                    <tr key={s.sessionId}>
                      <td>{s.labId}</td>
                      <td className="mono">{s.userId}</td>
                      <td>{minutes(s.uptime)}</td>
                      <td>{minutes(s.idleMs)}</td>
                      <td>{s.fromPool ? 'pool' : 'cold'} · {s.claimMs} ms</td>
                      <td>
                        <button className="btn btn-ghost btn-xs" onClick={() => act(() => adminApi.stopSandbox(token, s.sessionId))} disabled={busy}>
                          <Square size={12} /> Stop
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
