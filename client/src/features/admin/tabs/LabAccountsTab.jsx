import { useCallback, useEffect, useState } from 'react';
import { Download, KeyRound, Loader, Power, UserPlus } from 'lucide-react';
import { adminApi, errorMessage } from '../../../shared/services/api';

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

/** Make Lab IDs for a batch of students, reset a password, switch an account off or on. */
export default function LabAccountsTab() {
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ prefix: '', count: 10 });
  const [issued, setIssued] = useState(null); // passwords just made or reset: shown once

  const load = useCallback(async () => {
    try {
      const res = await adminApi.labAccounts({ search, limit: 100 });
      setAccounts(res.data.data);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'The server did not respond.'));
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

  if (!accounts) return error ? <p className="auth-error" role="alert">{error}</p> : <div className="page-loading"><Loader size={32} className="spin" /></div>;

  return (
    <>
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
          <input className="input" type="number" min="1" max="100" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} required aria-label="How many" />
          <button className="btn btn-primary btn-sm" disabled={busy}><UserPlus size={14} /> Generate</button>
        </form>
        <p className="admin-hint">Up to 100 at a time. IDs are numbered on from the last one with that prefix (srm-cse-0001, srm-cse-0002, …).</p>
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
    </>
  );
}
