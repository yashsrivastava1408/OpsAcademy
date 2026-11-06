import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, Loader, Trash2, TriangleAlert } from 'lucide-react';
import { collegeApi, errorMessage } from '../services/api';
import './AuthPage.css';
import './ExtraPages.css';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY = 24 * 60 * 60 * 1000;
const fmt = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/** College admins and trainers: when each batch gets the lab. Slots come from weekly templates, so a semester is one click. */
export default function CollegeSlotsPage() {
  const [colleges, setColleges] = useState(null);
  const [collegeId, setCollegeId] = useState(null);
  const [data, setData] = useState({ templates: [], sections: [], slots: [], blackouts: [] });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState({ weekday: 6, startTime: '10:00', durationMinutes: 120, seats: 60, sectionId: '' });
  const [range, setRange] = useState({ from: isoDate(0), to: isoDate(60) });
  const [blackout, setBlackout] = useState({ onDate: '', reason: '' });

  useEffect(() => {
    collegeApi.mine()
      .then((res) => {
        const list = res.data.data;
        setColleges(list);
        if (list[0]) setCollegeId(list[0].id);
      })
      .catch((err) => { setColleges([]); setError(errorMessage(err, 'Could not load your colleges.')); });
  }, []);

  const load = useCallback(async () => {
    if (!collegeId) return;
    try {
      const now = Date.now();
      const [templates, sections, slots, blackouts] = await Promise.all([
        collegeApi.templates(collegeId), collegeApi.sections(collegeId), collegeApi.slots(collegeId, now, now + 60 * DAY), collegeApi.blackouts(collegeId),
      ]);
      setData({ templates: templates.data.data, sections: sections.data.data, slots: slots.data.data, blackouts: blackouts.data.data });
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load the schedule.'));
    }
  }, [collegeId]);
  useEffect(() => { load(); }, [load]);

  const run = async (action, done) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await action();
      if (done) setNotice(done(res));
      await load();
    } catch (err) {
      setError(errorMessage(err, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  if (!colleges) return <div className="page-loading"><Loader size={32} className="spin" /></div>;
  if (colleges.length === 0) {
    return (
      <div className="auth-page"><div className="auth-card glass-card">
        <h1 className="auth-title">Lab schedule</h1>
        <p className="auth-lead">This page is for college admins and trainers. Your account is not part of a college yet.</p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <Link to="/dashboard" className="btn btn-primary auth-submit">Back to the dashboard</Link>
      </div></div>
    );
  }

  const college = colleges.find((c) => c.id === collegeId);
  const canEdit = college?.roles.some((r) => ['college_admin', 'platform_admin'].includes(r));
  const sectionName = (id) => data.sections.find((s) => s.id === id)?.name || 'All sections';

  return (
    <div className="admin-page">
      <div className="container">
        <div className="admin-header">
          <h1>Lab schedule · {college?.name}</h1>
          {colleges.length > 1 && (
            <select className="input" value={collegeId} onChange={(e) => setCollegeId(e.target.value)} aria-label="College">
              {colleges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {notice && <p className="auth-notice" role="status">{notice}</p>}

        {canEdit && (
          <section className="admin-section glass-card">
            <h2>Weekly pattern</h2>
            <form className="admin-actions" onSubmit={(e) => { e.preventDefault(); run(() => collegeApi.createTemplate(collegeId, { ...tpl, sectionId: tpl.sectionId || null, weekday: Number(tpl.weekday), durationMinutes: Number(tpl.durationMinutes), seats: Number(tpl.seats) })); }}>
              <select className="input" value={tpl.weekday} onChange={(e) => setTpl({ ...tpl, weekday: e.target.value })} aria-label="Day">{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
              <input className="input" type="time" value={tpl.startTime} onChange={(e) => setTpl({ ...tpl, startTime: e.target.value })} aria-label="Start time" required />
              <input className="input" type="number" min="15" max="480" value={tpl.durationMinutes} onChange={(e) => setTpl({ ...tpl, durationMinutes: e.target.value })} aria-label="Minutes" required />
              <input className="input" type="number" min="1" value={tpl.seats} onChange={(e) => setTpl({ ...tpl, seats: e.target.value })} aria-label="Seats" required />
              <select className="input" value={tpl.sectionId} onChange={(e) => setTpl({ ...tpl, sectionId: e.target.value })} aria-label="Section"><option value="">All sections</option>{data.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <button className="btn btn-primary btn-sm" disabled={busy}><CalendarPlus size={14} /> Add</button>
            </form>
            <ul className="admin-facts">
              {data.templates.map((t) => (
                <li key={t.id}>
                  {WEEKDAYS[t.weekday]} {t.startTime}, {t.durationMinutes} min, {t.seats} seats, {sectionName(t.sectionId)}
                  <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => run(() => collegeApi.deleteTemplate(collegeId, t.id))} aria-label="Delete pattern"><Trash2 size={12} /></button>
                </li>
              ))}
              {data.templates.length === 0 && <li className="profile-empty">No weekly pattern yet.</li>}
            </ul>
            <form className="admin-actions" onSubmit={(e) => { e.preventDefault(); run(() => collegeApi.generateSlots(collegeId, range), (res) => `Made ${res.data.data.created ?? 0} slot(s).`); }}>
              <input className="input" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From" required />
              <input className="input" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To" required />
              <button className="btn btn-secondary btn-sm" disabled={busy || data.templates.length === 0}>Generate slots</button>
            </form>
          </section>
        )}

        <section className="admin-section glass-card">
          <h2>Upcoming slots ({data.slots.length})</h2>
          {data.slots.length === 0 ? <p className="profile-empty">No slots in the next 60 days.</p> : (
            <div className="admin-table-wrap"><table className="admin-table">
              <thead><tr><th>When</th><th>Section</th><th>Seats</th><th>Students</th><th></th></tr></thead>
              <tbody>{data.slots.map((s) => (
                <tr key={s.id}>
                  <td>{fmt(s.startsAt)}{s.makeup ? ' (makeup)' : ''}</td>
                  <td>
                    {canEdit ? (
                      <select className="input" value={s.sectionId || ''} disabled={busy} onChange={(e) => run(() => collegeApi.updateSlot(collegeId, s.id, { sectionId: e.target.value || null }))} aria-label="Section for this slot">
                        <option value="">All sections</option>{data.sections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    ) : sectionName(s.sectionId)}
                  </td>
                  <td>{s.capacity}</td>
                  <td>{s.eligible}{s.warnings.length > 0 && <span title={s.warnings[0].message}> <TriangleAlert size={13} /></span>}</td>
                  <td>{canEdit && <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => run(() => collegeApi.deleteSlot(collegeId, s.id))} aria-label="Delete slot"><Trash2 size={12} /></button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>

        {canEdit && (
          <section className="admin-section glass-card">
            <h2>Days off</h2>
            <form className="admin-actions" onSubmit={(e) => { e.preventDefault(); run(() => collegeApi.addBlackout(collegeId, blackout)); }}>
              <input className="input" type="date" value={blackout.onDate} onChange={(e) => setBlackout({ ...blackout, onDate: e.target.value })} aria-label="Date" required />
              <input className="input" placeholder="Reason, e.g. exam week" value={blackout.reason} onChange={(e) => setBlackout({ ...blackout, reason: e.target.value })} aria-label="Reason" />
              <button className="btn btn-secondary btn-sm" disabled={busy}>Add day off</button>
            </form>
            <ul className="admin-facts">
              {data.blackouts.map((b) => <li key={b.id}>{b.onDate} {b.reason && `· ${b.reason}`} <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => run(() => collegeApi.removeBlackout(collegeId, b.id))} aria-label="Remove day off"><Trash2 size={12} /></button></li>)}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
