import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound, Loader } from 'lucide-react';
import { errorMessage } from '../../shared/services/api';
import { completePasswordReset } from './supabaseIdentity';
import './AuthPage.css';

/** Opened from the emailed link: choose a new password and get signed in. */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await completePasswordReset(password);
      navigate('/dashboard');
    } catch (err) {
      setError(errorMessage(err, 'Could not reach the server. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card glass-card animate-scale-in" onSubmit={submit}>
        <h1 className="auth-title"><KeyRound size={18} /> Choose a new password</h1>
        <p className="auth-lead">Signing in on other devices will need the new password.</p>
        <label className="auth-field">
          <span>New password (at least 8 characters)</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
            autoFocus
          />
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary auth-submit" disabled={submitting}>
          {submitting ? <Loader size={16} className="spin" /> : 'Save password and log in'}
        </button>
        <Link to="/login" className="auth-link">Back to log in</Link>
      </form>
    </div>
  );
}
