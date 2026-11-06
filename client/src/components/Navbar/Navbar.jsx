import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Compass, Sparkles, Flame, Zap, LogOut } from 'lucide-react';
import useAuth from '../../hooks/useAuth';
import useProgress from '../../hooks/useProgress';
import PortalSwitch from './PortalSwitch';
import './Navbar.css';

export default function Navbar() {
  const location = useLocation();
  const { user, isRegistered, logout } = useAuth();
  const progress = useProgress();
  const isActive = (path) => location.pathname === path ? 'active' : '';

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

        {/* Navigation Links */}
        <ul className="navbar-nav">
          <li>
            <Link to="/dashboard" className={`navbar-link ${isActive('/dashboard')}`}>
              <LayoutDashboard size={16} />
              <span>Theory</span>
            </Link>
          </li>
          <li>
            <Link to="/roadmap" className={`navbar-link ${isActive('/roadmap')}`}>
              <Compass size={16} />
              <span>DevOps Roadmap</span>
            </Link>
          </li>
          <li>
            <Link to="/casestudies" className={`navbar-link ${isActive('/casestudies')}`}>
              <Sparkles size={16} className="text-lime" />
              <span>Case Studies</span>
            </Link>
          </li>
        </ul>

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
