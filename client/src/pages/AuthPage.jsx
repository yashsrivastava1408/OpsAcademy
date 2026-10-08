import { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { Loader, LogIn, UserPlus } from 'lucide-react';
import useAuth from '../hooks/useAuth';
import { authApi, errorMessage } from '../services/api';
import './AuthPage.css';

export default function AuthPage() {
  const navigate = useNavigate();
  const { isRegistered, login, register } = useAuth();

  const [mode, setMode] = useState('register'); // register | login | forgot
  const [resetNotice, setResetNotice] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (isRegistered) return <Navigate to="/dashboard" replace />;

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'forgot') {
        const res = await authApi.forgotPassword(form.email);
        setResetNotice(res.data);
        return;
      }
      if (mode === 'register') await register(form.name, form.email, form.password);
      else await login(form.email, form.password);
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
        <div className="auth-tabs">
          <button type="button" className={`auth-tab ${mode === 'register' ? 'active' : ''}`} onClick={() => { setMode('register'); setError(null); }}>
            <UserPlus size={15} /> Create account
          </button>
          <button type="button" className={`auth-tab ${mode !== 'register' ? 'active' : ''}`} onClick={() => { setMode('login'); setError(null); }}>
            <LogIn size={15} /> Log in
          </button>
        </div>

        <p className="auth-lead">
          {mode === 'register' && 'Keep your progress across devices and earn certificates in your name. Anything you have done as a guest comes with you.'}
          {mode === 'login' && 'Welcome back. Log in to pick up where you left off.'}
          {mode === 'forgot' && 'Enter the email address of your account and we will send a link to choose a new password.'}
        </p>

        {mode === 'register' && (
          <label className="auth-field">
            <span>Name (as it should appear on certificates)</span>
            <input className="input" type="text" value={form.name} onChange={update('name')} autoComplete="name" maxLength={80} required />
          </label>
        )}

        <label className="auth-field">
          <span>Email</span>
          <input className="input" type="email" value={form.email} onChange={update('email')} autoComplete="email" required />
        </label>

        {mode !== 'forgot' && (
        <label className="auth-field">
          <span>Password{mode === 'register' ? ' (at least 8 characters)' : ''}</span>
          <input
            className="input"
            type="password"
            value={form.password}
            onChange={update('password')}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            minLength={mode === 'register' ? 8 : undefined}
            required
          />
        </label>
        )}

        {error && <p className="auth-error" role="alert">{error}</p>}

        {mode === 'forgot' && resetNotice && (
          <div className="auth-notice" role="status">
            <p>{resetNotice.message}</p>
            {!resetNotice.emailConfigured && !resetNotice.devResetLink && (
              <p>This server is not set up to send email, so the link cannot reach you. Ask whoever runs it.</p>
            )}
            {resetNotice.devResetLink && (
              <p>
                Email is not set up on this development server, so here is the link it would have sent:{' '}
                <Link to={resetNotice.devResetLink.replace(/^https?:\/\/[^/]+/, '')}>choose a new password</Link>
              </p>
            )}
          </div>
        )}

        <button type="submit" className="btn btn-primary auth-submit" disabled={submitting}>
          {submitting ? <Loader size={16} className="spin" /> : mode === 'register' ? 'Create account' : mode === 'login' ? 'Log in' : 'Send reset link'}
        </button>

        {mode === 'login' && (
          <button type="button" className="auth-link" onClick={() => { setMode('forgot'); setError(null); setResetNotice(null); }}>
            Forgot your password?
          </button>
        )}
        {mode === 'forgot' && (
          <button type="button" className="auth-link" onClick={() => { setMode('login'); setError(null); }}>
            Back to log in
          </button>
        )}
      </form>
    </div>
  );
}
