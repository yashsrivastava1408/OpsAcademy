import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Share2, X, ShieldCheck, Loader } from 'lucide-react';
import { certificateApi, errorMessage } from '../../services/api';
import useAuth from '../../hooks/useAuth';
import './CertificateModal.css';

/**
 * Issues (or fetches) the signed certificate for a completed unit and shows
 * it. Everything printed on it comes from the server record.
 */
export default function CertificateModal({ unit, onClose, onIssued }) {
  const { isRegistered } = useAuth();
  const [certificate, setCertificate] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isRegistered) return;
    let cancelled = false;
    certificateApi
      .issue(unit.id)
      .then((res) => {
        if (cancelled) return;
        setCertificate(res.data.data);
        if (onIssued) onIssued(res.data.data);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, 'Could not issue the certificate.'));
      });
    return () => { cancelled = true; };
    // onIssued is a fresh function each render; the unit is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit.id, isRegistered]);

  const verifyUrl = certificate ? `${window.location.origin}/verify/${certificate.id}` : '';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(verifyUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked: the link is visible on the certificate */ }
  };

  return (
    <div className="cert-modal-overlay" onClick={onClose}>
      <div className="cert-modal glass-card animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <button className="cert-close-btn" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>

        {!isRegistered && (
          <div className="cert-message">
            <ShieldCheck size={32} />
            <h3>Create an account to get your certificate</h3>
            <p>
              A certificate is issued in your name and can be checked by anyone, so it needs an account.
              Your progress so far moves to the account automatically.
            </p>
            <Link to="/login" className="btn btn-primary">Create account</Link>
          </div>
        )}

        {isRegistered && error && (
          <div className="cert-message">
            <h3>Certificate not available</h3>
            <p>{error}</p>
          </div>
        )}

        {isRegistered && !error && !certificate && (
          <div className="cert-message">
            <Loader size={28} className="spin" />
            <p>Issuing your certificate...</p>
          </div>
        )}

        {certificate && (
          <>
            {/* Certificate Frame */}
            <div className="certificate-frame" id="printable-cert">
              <div className="cert-border-outer">
                <div className="cert-border-inner">
                  <div className="cert-header">
                    <div className="cert-logo">
                      <ShieldCheck size={32} />
                      <span>OpsAcademy</span>
                    </div>
                    <div className="cert-id">ID: {certificate.id}</div>
                  </div>

                  <div className="cert-body">
                    <span className="cert-subtitle">CERTIFICATE OF COMPLETION</span>
                    <h1 className="cert-title">{certificate.unitTitle}</h1>

                    <p className="cert-text-lead">This is to certify that</p>
                    <h2 className="cert-recipient">{certificate.studentName}</h2>

                    <p className="cert-description">
                      completed every hands-on lab step of this unit. Each step was checked automatically
                      inside a live sandbox, with a first-attempt accuracy of <strong>{certificate.score}%</strong>.
                    </p>

                    <p className="cert-verify">Verify at {verifyUrl}</p>
                  </div>

                  <div className="cert-footer">
                    <div className="cert-sign">
                      <div className="sign-line">OpsAcademy</div>
                      <span className="sign-label">Automated Assessment</span>
                    </div>
                    <div className="cert-date">
                      <div className="date-value">
                        {new Date(certificate.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                      </div>
                      <span className="sign-label">Issue Date</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="cert-actions no-print">
              <button className="btn btn-primary" onClick={() => window.print()}>
                <Download size={16} /> Print / Save PDF
              </button>
              <button className="btn btn-secondary" onClick={copyLink}>
                <Share2 size={16} /> {copied ? 'Link copied' : 'Copy verification link'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
