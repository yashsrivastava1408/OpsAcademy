import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader, MailCheck, MailX } from 'lucide-react';
import { authApi, errorMessage, getStoredUser, updateStoredUser } from '../services/api';
import './AuthPage.css';
import './VerifyPage.css';

/** Opened from the emailed link: confirms the account's email address. */
export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState({ status: 'loading', message: '' });
  // The link works once, so it must not be sent twice (React runs effects twice in development).
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (!token) {
      setState({ status: 'error', message: 'This link is incomplete. Open the link from your email again.' });
      return;
    }
    authApi.verifyEmail(token)
      .then((res) => {
        // If this browser is signed in as that account, show it as confirmed straight away.
        if (getStoredUser()?.id === res.data.user.id) updateStoredUser(res.data.user);
        setState({ status: 'done', message: res.data.user.email });
      })
      .catch((err) => setState({ status: 'error', message: errorMessage(err, 'The server did not respond. Please try again in a minute.') }));
  }, [token]);

  return (
    <div className="auth-page">
      <div className="auth-card glass-card verify-card animate-scale-in">
        {state.status === 'loading' && (
          <>
            <Loader size={32} className="spin" />
            <p>Confirming your email address...</p>
          </>
        )}
        {state.status === 'done' && (
          <>
            <MailCheck size={40} className="verify-ok" />
            <h1>Email confirmed</h1>
            <p className="verify-lead"><span className="mono">{state.message}</span> is now confirmed for your account.</p>
          </>
        )}
        {state.status === 'error' && (
          <>
            <MailX size={40} className="verify-bad" />
            <h1>Could not confirm</h1>
            <p className="verify-lead">{state.message}</p>
          </>
        )}
        <Link to="/dashboard" className="btn btn-secondary btn-sm">Go to the dashboard</Link>
      </div>
    </div>
  );
}
