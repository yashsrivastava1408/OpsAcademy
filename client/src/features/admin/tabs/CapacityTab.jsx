import { useEffect, useState } from 'react';
import { Loader } from 'lucide-react';
import { adminApi, errorMessage } from '../../../shared/services/api';

const fmt = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** How many lab servers the next two weeks of slots need, and where students drop off on the way into a lab. */
export default function CapacityTab() {
  const [plan, setPlan] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([adminApi.capacityPlan(14), adminApi.labFunnel(7)])
      .then(([p, f]) => { setPlan(p.data.data); setFunnel(f.data.data); })
      .catch((err) => setError(errorMessage(err, 'The server did not respond.')));
  }, []);

  if (error) return <p className="auth-error" role="alert">{error}</p>;
  if (!plan || !funnel) return <div className="page-loading"><Loader size={32} className="spin" /></div>;

  return (
    <>
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
          {funnel.steps.map((s) => (
            <div key={s.step} className="admin-facts-row">
              <dt>Step “{s.step}”</dt><dd>{s.ok} ok, {s.failed} failed ({s.dropOffPercent}% drop-off)</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
