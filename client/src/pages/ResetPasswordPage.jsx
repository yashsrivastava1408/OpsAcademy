import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Loader } from 'lucide-react';
import { authApi, errorMessage, setIdentity } from '../services/api';
import './AuthPage.css';

/** Opened from the emailed link: choose a new password and get signed in. */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await authApi.resetPassword(token, password);
      setIdentity(res.data.token, res.data.user);
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
        {!token ? (
          <p className="auth-error" role="alert">This link is incomplete. Open the link from your email again, or ask for a new one.</p>
        ) : (
          <>
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
          </>
        )}
        <Link to="/login" className="auth-link">Back to log in</Link>
      </form>
    </div>
  );
}
