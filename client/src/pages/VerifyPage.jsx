import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader, ShieldCheck, ShieldX } from 'lucide-react';
import { certificateApi } from '../services/api';
import './AuthPage.css';
import './VerifyPage.css';

/** Public page: anyone with a certificate ID can check that it is genuine. */
export default function VerifyPage() {
  const { certificateId } = useParams();
  const [state, setState] = useState({ status: 'loading', certificate: null });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', certificate: null });
    certificateApi
      .verify(certificateId)
      .then((res) => {
        if (!cancelled) setState({ status: 'valid', certificate: res.data.data });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: err.response?.status === 404 ? 'invalid' : 'error', certificate: null });
      });
    return () => { cancelled = true; };
  }, [certificateId]);

  const { status, certificate } = state;

  return (
    <div className="auth-page">
      <div className="auth-card glass-card verify-card animate-scale-in">
        {status === 'loading' && (
          <>
            <Loader size={32} className="spin" />
            <p>Checking certificate {certificateId}...</p>
          </>
        )}

        {status === 'valid' && (
          <>
            <ShieldCheck size={40} className="verify-ok" />
            <h1>Certificate verified</h1>
            <p className="verify-lead">This certificate was issued by OpsAcademy and has not been altered.</p>
            <dl className="verify-details">
              <dt>Awarded to</dt><dd>{certificate.studentName}</dd>
              <dt>For completing</dt><dd>{certificate.unitTitle}</dd>
              <dt>Issued</dt>
              <dd>{new Date(certificate.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</dd>
              <dt>First-attempt accuracy</dt><dd>{certificate.score}%</dd>
              <dt>Certificate ID</dt><dd className="mono">{certificate.id}</dd>
            </dl>
            <p className="verify-note">
              Completion means every lab step of the unit passed an automated check inside a live sandbox.
            </p>
          </>
        )}

        {status === 'invalid' && (
          <>
            <ShieldX size={40} className="verify-bad" />
            <h1>Not a valid certificate</h1>
            <p className="verify-lead">
              No certificate with the ID <span className="mono">{certificateId}</span> was issued by OpsAcademy,
              or its record has been tampered with.
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <ShieldX size={40} className="verify-bad" />
            <h1>Couldn't check right now</h1>
            <p className="verify-lead">The verification service did not respond. Please try again in a minute.</p>
          </>
        )}

        <Link to="/" className="btn btn-secondary btn-sm">About OpsAcademy</Link>
      </div>
    </div>
  );
}
