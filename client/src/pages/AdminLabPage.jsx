import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, KeyRound, Loader, Power, UserPlus } from 'lucide-react';
import { adminApi, errorMessage } from '../services/api';
import './AuthPage.css';
import './ExtraPages.css';

const fmt = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Passwords are shown once; this puts them in a CSV the admin can hand to the college. */
function downloadCsv(rows) {
  const quote = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const text = ['lab_id,name,password', ...rows.map((r) => [r.username, r.name, r.password].map(quote).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lab-accounts.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/** Platform admin: Lab IDs, the capacity plan and where students drop off entering the lab. */
export default function AdminLabPage() {
  const [accounts, setAccounts] = useState({ total: 0, accounts: [] });
  const [plan, setPlan] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ prefix: '', count: 10 });
  const [issued, setIssued] = useState(null); // passwords just made or reset: shown once

  const load = useCallback(async () => {
    try {
      const [a, p, f] = await Promise.all([adminApi.labAccounts({ search, limit: 100 }), adminApi.capacityPlan(14), adminApi.labFunnel(7)]);
      setAccounts(a.data.data);
      setPlan(p.data.data);
      setFunnel(f.data.data);
      setError(null);
    } catch (err) {
      const status = err.response?.status;
      setError(status === 401 || status === 403 ? 'This page is for platform administrators.' : errorMessage(err, 'The server did not respond.'));
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const run = async (action) => {
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

  const generate = (e) => {
    e.preventDefault();
    run(async () => {
      const res = await adminApi.generateLabAccounts({ prefix: form.prefix, count: Number(form.count) });
      setIssued(res.data.data);
    });
  };

  if (error && !plan) {
    return (
      <div className="auth-page"><div className="auth-card glass-card">
        <h1 className="auth-title">Lab administration</h1>
        <p className="auth-error" role="alert">{error}</p>
        <Link to="/login" className="btn btn-primary auth-submit">Sign in</Link>
      </div></div>
    );
  }
  if (!plan) return <div className="page-loading"><Loader size={32} className="spin" /></div>;

  return (
    <div className="admin-page">
      <div className="container">
        <div className="admin-header"><h1>Lab administration</h1><Link to="/admin" className="btn btn-secondary btn-sm">Operator overview</Link></div>
        {error && <p className="auth-error" role="alert">{error}</p>}

        {issued && (
          <section className="admin-section glass-card" role="status">
            <h2>New passwords (shown only once)</h2>
            <p>Download them now. They cannot be shown again; you can only reset a password.</p>
            <div className="admin-actions">
              <button className="btn btn-primary btn-sm" onClick={() => downloadCsv(issued)}><Download size={14} /> Download CSV</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setIssued(null)}>I have saved them</button>
            </div>
            <div className="admin-table-wrap"><table className="admin-table">
              <thead><tr><th>Lab ID</th><th>Name</th><th>Password</th></tr></thead>
              <tbody>{issued.map((r) => <tr key={r.username}><td className="mono">{r.username}</td><td>{r.name}</td><td className="mono">{r.password}</td></tr>)}</tbody>
            </table></div>
          </section>
        )}

        <section className="admin-section glass-card">
          <h2>Make Lab IDs</h2>
          <form onSubmit={generate} className="admin-actions">
            <input className="input" placeholder="prefix, e.g. srm-cse" value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} required aria-label="Prefix" />
            <input className="input" type="number" min="1" max="500" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} required aria-label="How many" />
            <button className="btn btn-primary btn-sm" disabled={busy}><UserPlus size={14} /> Generate</button>
          </form>
        </section>

        <section className="admin-section glass-card">
          <h2>Lab accounts ({accounts.total})</h2>
          <input className="input" placeholder="Search by Lab ID or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          <div className="admin-table-wrap"><table className="admin-table">
            <thead><tr><th>Lab ID</th><th>Name</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {accounts.accounts.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{a.username}</td><td>{a.name}</td><td>{a.disabled ? 'disabled' : 'active'}</td>
                  <td>
                    <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => run(async () => setIssued([(await adminApi.resetLabPassword(a.id)).data.data]))}><KeyRound size={12} /> Reset password</button>
                    <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => run(() => adminApi.setLabAccountDisabled(a.id, !a.disabled))}><Power size={12} /> {a.disabled ? 'Enable' : 'Disable'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>

        <section className="admin-section glass-card">
          <h2>Capacity plan (next 14 days)</h2>
          <p>Up to <strong>{plan.maxServersNeeded}</strong> lab server(s) needed, at {plan.learnersPerServer} learners per server.</p>
          {plan.days.length === 0 ? <p className="profile-empty">No slots are scheduled.</p> : (
            <div className="admin-table-wrap"><table className="admin-table">
              <thead><tr><th>Date</th><th>Slots</th><th>Peak seats</th><th>Servers</th></tr></thead>
              <tbody>{plan.days.map((d) => (
                <tr key={d.date}><td>{d.date}</td><td>{d.slots.map((s) => `${s.college} ${fmt(s.startsAt)}`).join('; ')}</td><td>{d.peakSeats}</td><td>{d.serversNeeded}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>

        <section className="admin-section glass-card">
          <h2>Entering the lab (last {funnel.days} days)</h2>
          <dl className="admin-facts">
            <dt>Switched to Lab</dt><dd>{funnel.switchesToLab}</dd>
            <dt>Switched to Theory</dt><dd>{funnel.switchesToTheory}</dd>
            <dt>Joined the queue</dt><dd>{funnel.queueJoined}</dd>
            <dt>Left the queue</dt><dd>{funnel.queueLeft}</dd>
            <dt>Admitted from the queue</dt><dd>{funnel.queueAdmitted}</dd>
            <dt>Blocked</dt><dd>{funnel.blocked}</dd>
            {funnel.steps.map((s) => (<><dt key={`${s.step}-t`}>Step “{s.step}”</dt><dd key={`${s.step}-d`}>{s.ok} ok, {s.failed} failed ({s.dropOffPercent}% drop-off)</dd></>))}
          </dl>
        </section>
      </div>
    </div>
  );
}
