import { useCallback, useState } from 'react';
import { Loader, RefreshCw, Square } from 'lucide-react';
import { adminApi, errorMessage } from '../../../shared/services/api';
import usePolling from '../../../shared/hooks/usePolling';

const REFRESH_MS = 10000;

const minutes = (ms) => `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
const yesNo = (value) => (value ? 'yes' : 'no');

/** The live state of the platform: sandboxes in use, accounts, service health, and a way to stop a sandbox. */
export default function OverviewTab() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminApi.overview();
      setOverview(res.data.data);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'The server did not respond.'));
    }
  }, []);

  usePolling(load, REFRESH_MS, true);

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

  if (!overview) {
    return error
      ? <p className="auth-error" role="alert">{error}</p>
      : <div className="page-loading"><Loader size={32} className="spin" /></div>;
  }

  const { sandbox, sandboxes, users, progress, services, limits } = overview;
  return (
    <div>
      <div className="admin-actions admin-tab-actions">
        <button className="btn btn-secondary btn-sm" onClick={() => act(() => adminApi.refillPool())} disabled={busy}>
          <RefreshCw size={14} /> Refill pool
        </button>
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
                      <button className="btn btn-ghost btn-xs" onClick={() => act(() => adminApi.stopSandbox(s.sessionId))} disabled={busy}>
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
  );
}
