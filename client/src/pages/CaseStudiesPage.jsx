import { Link } from 'react-router-dom';
import {
  Sparkles,
  BookOpen,
  Terminal,
  Award,
  Cpu,
  Layers,
  CheckCircle2,
} from 'lucide-react';
import './CaseStudiesPage.css';

const FEATURED_CASE_STUDIES = [
  {
    id: 'realworld-internship-case-study',
    title: 'Enterprise DevOps: GitOps, Change-Aware CI/CD & K8s Post-Mortem',
    domain: 'High-Growth SaaS & Security Infrastructure',
    summary: 'A real-world engineering case study covering zero-Kubernetes local dev contracts (make dev), dynamic change-aware Jenkins CI pipelines, ArgoCD GitOps reconciliation, and stuck Init:1/2 NetworkPolicy debugging.',
    tags: ['Local Dev Contract', 'Change-Aware CI', 'GitOps (ArgoCD)', 'NetworkPolicy Post-Mortem'],
    duration: '60 min',
    architectureHighlights: [
      'Zero-K8s local dev reproducible contract using Makefile & Docker Compose',
      'Change-aware CI pipeline with secret leak scan and dynamic build matrix',
      'ArgoCD pull-based reconciliation with Harbor image registry',
      'K8s NetworkPolicy label mismatch troubleshooting (kubernetes.io/metadata.name)'
    ]
  }
];

export default function CaseStudiesPage() {

  return (
    <div className="case-studies-page">
      <div className="container">
        {/* ── Hero Header ────────────────────────────────────────── */}
        <div className="case-studies-hero glass-card animate-fade-in">
          <div className="hero-content">
            <div className="badge-case-glow">
              <Sparkles size={16} />
              <span>Real-World Engineering Hub</span>
            </div>
            <h1 className="case-hero-title">
              Production <span className="gradient-text">DevOps Case Studies</span> & Post-Mortems
            </h1>
            <p className="case-hero-subtitle">
              Learn how senior DevOps & SRE engineers architect cloud infrastructure, debug production outages, automate CI/CD pipelines, and design zero-downtime GitOps rollouts.
            </p>
          </div>

          <div className="hero-stats">
            <div className="hero-stat-box">
              <span className="stat-num">100%</span>
              <span className="stat-desc">Real Production Incidents</span>
            </div>
            <div className="hero-stat-box">
              <span className="stat-num">4 Modes</span>
              <span className="stat-desc">Learn • Practice • Prepare • Debrief</span>
            </div>
          </div>
        </div>

        {/* ── Featured Case Study Deep Dive Card ────────────────── */}
        <div className="case-study-feature-grid">
          {FEATURED_CASE_STUDIES.map((study) => (
            <div key={study.id} className="case-study-main-card glass-card animate-fade-in-up">
              <div className="card-top-meta">
                <span className="badge-domain">
                  <Cpu size={14} /> {study.domain}
                </span>
                <span className="badge-time">
                  <Sparkles size={14} /> {study.duration} Read & Lab
                </span>
              </div>

              <h2 className="case-card-title">{study.title}</h2>
              <p className="case-card-summary">{study.summary}</p>

              {/* Tags */}
              <div className="case-tags">
                {study.tags.map((tag, idx) => (
                  <span key={idx} className="case-tag-pill">
                    #{tag}
                  </span>
                ))}
              </div>

              {/* Architecture Highlights */}
              <div className="architecture-highlights-box">
                <h4 className="highlights-title">
                  <Layers size={16} /> Key Production Breakthroughs:
                </h4>
                <div className="highlights-list">
                  {study.architectureHighlights.map((hl, i) => (
                    <div key={i} className="highlight-item">
                      <CheckCircle2 size={14} className="icon-cyan" />
                      <span>{hl}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Launchers */}
              <div className="case-action-deck">
                <Link to={`/unit/${study.id}/learn`} className="btn btn-primary btn-md">
                  <BookOpen size={16} />
                  Read Architecture Case Study
                </Link>
                <Link to={`/unit/${study.id}/practice`} className="btn btn-secondary btn-md">
                  <Terminal size={16} />
                  Launch Live Terminal Lab
                </Link>
                <Link to={`/unit/${study.id}/prepare`} className="btn btn-ghost btn-md">
                  <Award size={16} />
                  Interview Q&A Deck
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
