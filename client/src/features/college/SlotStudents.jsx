import { useCallback, useEffect, useState } from 'react';
import { UserMinus, UserPlus } from 'lucide-react';
import { collegeApi, errorMessage } from '../../shared/services/api';

/**
 * A trainer's per-student override for one slot: add a student who missed their own slot (a makeup),
 * or take one out. The server warns when the slot would be over capacity.
 */
export default function SlotStudents({ collegeId, slotId, students }) {
  const [rows, setRows] = useState([]);
  const [pick, setPick] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    collegeApi.assignments(collegeId, slotId).then((res) => setRows(res.data.data)).catch((err) => setMessage(errorMessage(err)));
  }, [collegeId, slotId]);
  useEffect(load, [load]);

  const change = async (action) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await action();
      const warning = res?.data?.data?.warnings?.[0];
      if (warning) setMessage(warning.message);
      setPick('');
      load();
    } catch (err) {
      setMessage(errorMessage(err, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  const taken = new Set(rows.map((r) => r.userId));
  const choices = students.filter((s) => !taken.has(s.userId));

  return (
    <div className="slot-students">
      <div className="admin-actions">
        <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Student to add">
          <option value="">Add a student…</option>
          {choices.map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" disabled={!pick || busy} onClick={() => change(() => collegeApi.assignStudent(collegeId, slotId, pick, 'add'))}><UserPlus size={13} /> Add</button>
      </div>
      {message && <p className="auth-notice" role="status">{message}</p>}
      <ul className="admin-facts">
        {rows.length === 0 && <li className="profile-empty">No individual changes. The whole section may use this slot.</li>}
        {rows.map((r) => (
          <li key={r.userId}>
            {r.name || r.userId} · {r.kind === 'add' ? 'added' : 'taken out'}
            <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => change(() => collegeApi.clearStudent(collegeId, slotId, r.userId))} aria-label="Undo this change"><UserMinus size={12} /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}
