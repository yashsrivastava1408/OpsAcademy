import { lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, Loader } from 'lucide-react';
import useAuth from '../auth/useAuth';
import '../auth/AuthPage.css';
import '../../shared/styles/ExtraPages.css';

const OverviewTab = lazy(() => import('./tabs/OverviewTab'));
const LabAccountsTab = lazy(() => import('./tabs/LabAccountsTab'));
const CapacityTab = lazy(() => import('./tabs/CapacityTab'));

const TABS = [
  { id: 'overview', label: 'Overview', Component: OverviewTab },
  { id: 'lab-accounts', label: 'Lab accounts', Component: LabAccountsTab },
  { id: 'capacity', label: 'Capacity and funnel', Component: CapacityTab },
];

/**
 * Platform admin dashboard. The roles in the session only decide what to show; the server checks the role
 * in the database on every admin call (ADR 0003), so a tampered client gets nothing.
 */
export default function AdminPage() {
  const { user, ready } = useAuth();
  const [params, setParams] = useSearchParams();
  const active = TABS.find((t) => t.id === params.get('tab')) || TABS[0];

  if (!ready) return <div className="page-loading"><Loader size={32} className="spin" /></div>;

  if (!user?.roles?.includes('platform_admin')) {
    return (
      <div className="auth-page">
        <div className="auth-card glass-card">
          <h1 className="auth-title"><Activity size={18} /> Operator access</h1>
          <p className="auth-error" role="alert">This page is for platform administrators. Sign in with an administrator account.</p>
          <Link to="/login" className="btn btn-primary auth-submit">Sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="container">
        <div className="admin-header"><h1><Activity size={20} /> Admin dashboard</h1></div>
        <div className="admin-tabs" role="tablist" aria-label="Admin sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === active.id}
              className={`admin-tab${t.id === active.id ? ' active' : ''}`}
              onClick={() => setParams(t.id === 'overview' ? {} : { tab: t.id }, { replace: true })}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Suspense fallback={<div className="page-loading"><Loader size={32} className="spin" /></div>}>
          <active.Component />
        </Suspense>
      </div>
    </div>
  );
}
