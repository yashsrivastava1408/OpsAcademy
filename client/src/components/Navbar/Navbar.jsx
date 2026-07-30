import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Terminal, LayoutDashboard, Award, ShieldCheck, ExternalLink } from 'lucide-react';
import { getProgress } from '../../services/progressService';
import CertificateModal from '../CertificateModal/CertificateModal';
import './Navbar.css';

export default function Navbar() {
  const location = useLocation();
  const [progress, setProgress] = useState({ score: 0 });
  const [showCert, setShowCert] = useState(false);

  useEffect(() => {
    const p = getProgress();
    setProgress(p);

    const interval = setInterval(() => {
      setProgress(getProgress());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const isActive = (path) => location.pathname === path ? 'active' : '';

  return (
    <>
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
                Dashboard
              </Link>
            </li>
          </ul>

          {/* Right Actions */}
          <div className="navbar-actions">
            {/* Placement Readiness Badge */}
            <div className="navbar-status score-badge" title="DevOps Placement Readiness Score">
              <ShieldCheck size={14} className="score-icon" />
              <span>Readiness: {progress.score}%</span>
            </div>

            {/* Certificate Button */}
            <button className="btn btn-secondary btn-sm" onClick={() => setShowCert(true)}>
              <Award size={14} /> Certificate
            </button>

            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-icon"
              title="GitHub Repository"
            >
              <ExternalLink size={18} />
            </a>

            <Link to="/dashboard" className="btn btn-primary btn-sm">
              Start Learning
            </Link>
          </div>
        </div>
      </nav>

      {showCert && (
        <CertificateModal
          studentName="DevOps Student"
          score={progress.score || 100}
          onClose={() => setShowCert(false)}
        />
      )}
    </>
  );
}
