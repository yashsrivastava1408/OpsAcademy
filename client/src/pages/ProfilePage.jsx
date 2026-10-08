import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Award, CheckCircle2, Flame, Loader, ShieldCheck, Terminal, Zap } from 'lucide-react';
import { profileApi } from '../services/api';
import './ExtraPages.css';

const formatDate = (value) => new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/** A learner's public page: only shown for accounts that chose to share it. */
export default function ProfilePage() {
  const { slug } = useParams();
  const [state, setState] = useState({ status: 'loading', profile: null });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', profile: null });
    profileApi.get(slug)
      .then((res) => { if (!cancelled) setState({ status: 'ready', profile: res.data.data }); })
      .catch((err) => { if (!cancelled) setState({ status: err.response ? 'not_found' : 'offline', profile: null }); });
    return () => { cancelled = true; };
  }, [slug]);

  if (state.status === 'loading') {
    return <div className="page-loading"><Loader size={32} className="spin" /></div>;
  }

  if (state.status !== 'ready') {
    return (
      <div className="page-loading">
        <h2>{state.status === 'offline' ? "Couldn't load this profile" : 'Profile not found'}</h2>
        <p>
          {state.status === 'offline'
            ? 'The server did not respond. Please try again in a minute.'
            : 'There is no public profile at this address. Its owner may have turned sharing off.'}
        </p>
        <Link to="/" className="btn btn-secondary">About OpsAcademy</Link>
      </div>
    );
  }

  const { profile } = state;
  return (
    <div className="profile-page">
      <div className="container profile-container">
        <header className="profile-header glass-card">
          <div className="profile-avatar">{profile.name.trim().charAt(0).toUpperCase()}</div>
          <div>
            <h1>{profile.name}</h1>
            <p>Learning DevOps on OpsAcademy since {formatDate(profile.memberSince)}</p>
          </div>
        </header>

        <div className="profile-stats">
          <div className="profile-stat glass-card"><Zap size={18} /><strong>{profile.xp}</strong><span>XP · level {profile.level}</span></div>
          <div className="profile-stat glass-card"><Flame size={18} /><strong>{profile.streak.longest}</strong><span>day best streak</span></div>
          <div className="profile-stat glass-card"><Terminal size={18} /><strong>{profile.stepsPassed}</strong><span>of {profile.stepsTotal} lab steps verified</span></div>
          <div className="profile-stat glass-card"><Award size={18} /><strong>{profile.certificates.length}</strong><span>certificate{profile.certificates.length === 1 ? '' : 's'}</span></div>
        </div>

        <section className="profile-section glass-card">
          <h2><CheckCircle2 size={16} /> Completed labs</h2>
          {profile.completedUnits.length === 0 ? (
            <p className="profile-empty">No lab completed yet.</p>
          ) : (
            <ul className="profile-list">
              {profile.completedUnits.map((unit) => (
                <li key={unit.unitId}>
                  <span>{unit.title}</span>
                  <span className="profile-date">{formatDate(unit.completedAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="profile-note">A lab counts as completed when every step passed an automated check inside a live sandbox.</p>
        </section>

        <section className="profile-section glass-card">
          <h2><ShieldCheck size={16} /> Certificates</h2>
          {profile.certificates.length === 0 ? (
            <p className="profile-empty">No certificate issued yet.</p>
          ) : (
            <ul className="profile-list">
              {profile.certificates.map((cert) => (
                <li key={cert.id}>
                  <span>{cert.unitTitle}</span>
                  <Link to={`/verify/${cert.id}`} className="cert-link">{cert.id}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
