import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { labPortalApi } from '../../shared/services/api';

const fmt = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The learner's next lab slots. Renders nothing when there are none (open labs, or no slots assigned). */
export default function LabSlotCard() {
  const [slots, setSlots] = useState([]);
  useEffect(() => {
    let cancelled = false;
    labPortalApi.mySlots().then((res) => { if (!cancelled) setSlots(res.data.data || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (slots.length === 0) return null;
  return (
    <div className="glass-card" style={{ padding: 16, marginBottom: 16 }}>
      <h3 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><CalendarClock size={16} /> Your lab slots</h3>
      <ul>
        {slots.slice(0, 3).map((s) => (
          <li key={s.id}>{fmt(s.startsAt)} – {new Date(s.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{s.makeup ? ' (makeup)' : ''}</li>
        ))}
      </ul>
    </div>
  );
}
