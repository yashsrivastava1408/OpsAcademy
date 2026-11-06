import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader, MailX } from 'lucide-react';
import { completeCallback } from '../services/supabaseIdentity';
import './AuthPage.css';
import './VerifyPage.css';

/** Where email-confirmation links and single sign-on return to: finishes the sign-in, then opens the dashboard. */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  // The one-time code in the link can be used once, and React runs effects twice in development.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    completeCallback()
      .then((user) => {
        if (user) navigate('/dashboard', { replace: true });
        else setError('This link is invalid or has expired. Log in, or ask for a new link.');
      })
      .catch((err) => setError(err.message || 'Could not finish signing you in. Please try again.'));
  }, [navigate]);

  return (
    <div className="auth-page">
      <div className="auth-card glass-card verify-card animate-scale-in">
        {error ? (
          <>
            <MailX size={40} className="verify-bad" />
            <h1>Could not sign you in</h1>
            <p className="verify-lead">{error}</p>
            <Link to="/login" className="btn btn-secondary btn-sm">Back to log in</Link>
          </>
        ) : (
          <>
            <Loader size={32} className="spin" />
            <p>Signing you in...</p>
          </>
        )}
      </div>
    </div>
  );
}
