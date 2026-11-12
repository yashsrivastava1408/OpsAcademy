import { Link } from 'react-router-dom';
import { Flame, Zap, LogOut } from 'lucide-react';
import useAuth from '../../../features/auth/useAuth';
import useProgress from '../../hooks/useProgress';
import PortalSwitch from './PortalSwitch';
import './Navbar.css';

export default function Navbar() {
  const { user, isRegistered, logout } = useAuth();
  const progress = useProgress();

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        {/* Brand */}
        <Link to="/" className="navbar-brand">
          <div className="navbar-logo">
            <span className="navbar-logo-prompt">&gt;_</span>
          </div>
          <div className="navbar-brand-text">
            Ops<span>Academy</span>
          </div>
        </Link>

        {/* Right Actions */}
        <div className="navbar-actions">
          {progress.xp > 0 && (
            <Link to="/dashboard" className="nav-progress" title={`Level ${progress.level}`}>
              <span><Zap size={13} /> {progress.xp} XP</span>
              {progress.streak.current > 0 && <span><Flame size={13} /> {progress.streak.current}</span>}
            </Link>
          )}

          {isRegistered ? (
            <div className="nav-user">
              {user.roles?.includes('platform_admin') && <Link to="/admin" className="btn btn-ghost btn-sm">Admin</Link>}
              {user.roles?.some((r) => r !== 'platform_admin') && <Link to="/college" className="btn btn-ghost btn-sm hide-mobile">Schedule</Link>}
              <span className="nav-user-name" title={user.email}>{user.name}</span>
              <button className="btn btn-ghost btn-icon" onClick={logout} title="Log out" aria-label="Log out">
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost btn-sm">Sign in</Link>
              <Link to="/login?tab=lab" className="btn btn-secondary btn-sm hide-mobile">Lab login</Link>
            </>
          )}

          <PortalSwitch enabled={isRegistered} />
        </div>
      </div>
    </nav>
  );
}
