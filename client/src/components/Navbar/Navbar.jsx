import { Link, useLocation } from 'react-router-dom';
import { Terminal, LayoutDashboard, BookOpen, Github } from 'lucide-react';
import './Navbar.css';

export default function Navbar() {
  const location = useLocation();

  const isActive = (path) => location.pathname === path ? 'active' : '';

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        {/* Brand */}
        <Link to="/" className="navbar-brand">
          <div className="navbar-logo">
            <Terminal size={18} />
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
              Labs
            </Link>
          </li>
          <li>
            <Link to="/about" className={`navbar-link ${isActive('/about')}`}>
              <BookOpen size={16} />
              Docs
            </Link>
          </li>
        </ul>

        {/* Right Actions */}
        <div className="navbar-actions">
          <div className="navbar-status">
            <span className="status-dot"></span>
            PTY Mode
          </div>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-icon"
            title="GitHub"
          >
            <Github size={18} />
          </a>
          <Link to="/dashboard" className="btn btn-primary btn-sm">
            Start Learning
          </Link>
        </div>
      </div>
    </nav>
  );
}
