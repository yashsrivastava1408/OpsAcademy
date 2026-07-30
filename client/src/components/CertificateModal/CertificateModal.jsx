import { useState } from 'react';
import { Download, Share2, X, ShieldCheck } from 'lucide-react';
import './CertificateModal.css';

export default function CertificateModal({ studentName = 'Student', score = 100, onClose }) {
  const [name, setName] = useState(studentName);
  const certId = `OPS-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  const issueDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="cert-modal-overlay" onClick={onClose}>
      <div className="cert-modal glass-card animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <button className="cert-close-btn" onClick={onClose}>
          <X size={20} />
        </button>

        {/* Name input */}
        <div className="cert-input-row no-print">
          <label>Your Name on Certificate:</label>
          <input
            type="text"
            className="input cert-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your full name"
          />
        </div>

        {/* Certificate Frame */}
        <div className="certificate-frame" id="printable-cert">
          <div className="cert-border-outer">
            <div className="cert-border-inner">
              <div className="cert-header">
                <div className="cert-logo">
                  <ShieldCheck size={32} />
                  <span>OpsAcademy</span>
                </div>
                <div className="cert-id">ID: {certId}</div>
              </div>

              <div className="cert-body">
                <span className="cert-subtitle">CERTIFICATE OF COMPLETION</span>
                <h1 className="cert-title">DevOps Engineering Foundations</h1>

                <p className="cert-text-lead">This is to certify that</p>
                <h2 className="cert-recipient">{name || 'DevOps Student'}</h2>

                <p className="cert-description">
                  has successfully demonstrated practical competence in Linux Systems, Docker Containerization, Git Version Control, and Kubernetes Orchestration with a Placement Readiness Score of <strong>{score}%</strong>.
                </p>

                <div className="cert-badges">
                  <span className="cert-badge-tag">Linux</span>
                  <span className="cert-badge-tag">Docker</span>
                  <span className="cert-badge-tag">Git</span>
                  <span className="cert-badge-tag">Kubernetes</span>
                </div>
              </div>

              <div className="cert-footer">
                <div className="cert-sign">
                  <div className="sign-line">OpsAcademy Evaluation Engine</div>
                  <span className="sign-label">Automated Assessment</span>
                </div>
                <div className="cert-date">
                  <div className="date-value">{issueDate}</div>
                  <span className="sign-label">Issue Date</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="cert-actions no-print">
          <button className="btn btn-primary" onClick={handlePrint}>
            <Download size={16} /> Print / Save PDF
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              navigator.clipboard.writeText(`I just completed OpsAcademy DevOps Foundations certification with ${score}% score!`);
              alert('Copied certificate announcement to clipboard!');
            }}
          >
            <Share2 size={16} /> Share Achievement
          </button>
        </div>
      </div>
    </div>
  );
}
