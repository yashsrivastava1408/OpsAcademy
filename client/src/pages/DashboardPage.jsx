import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  Clock,
  CheckCircle2,
  Terminal,
  Filter,
  BarChart3,
  BookOpen,
  Sparkles,
  Award,
} from 'lucide-react';
import { unitApi } from '../services/api';
import './DashboardPage.css';

const CATEGORIES = [
  'All',
  'Linux',
  'Containers',
  'Version Control',
  'Networking',
  'CI/CD',
  'Cloud',
  'Observability',
  'Infrastructure as Code',
  'System Design',
  'Security',
  'Automation',
  'GitOps',
];

const FALLBACK_UNITS = [
  { id: 'realworld-internship-case-study', title: 'Enterprise DevOps: GitOps, Change-Aware CI/CD & K8s Post-Mortem', description: 'Real-world engineering case study covering zero-K8s local dev contracts, change-aware Jenkins CI, ArgoCD GitOps reconciliation, and production K8s NetworkPolicy debugging.', category: 'GitOps', difficulty: 'advanced', duration: '60 min', isCaseStudy: true, objectives: ['Design zero-K8s reproducible local dev with Makefile & Docker Compose', 'Implement change-aware CI pipelines with security scanning', 'Configure GitOps CD reconciliation with ArgoCD, Harbor, and Kustomize', 'Troubleshoot stuck Init:1/2 containers and NetworkPolicy label mismatches'] },
  { id: 'linux-basics', title: 'Linux Fundamentals', description: 'Master Linux CLI, file permissions, shell commands, process management, and system administration.', category: 'Linux', difficulty: 'beginner', duration: '30 min', objectives: ['Explore file system hierarchy', 'Manage permissions with chmod/chown', 'Monitor processes with ps and top'] },
  { id: 'git-basics', title: 'Git & GitHub Workflow', description: 'Master version control, branching, merging, interactive rebasing, merge conflicts, and Pull Requests.', category: 'Version Control', difficulty: 'beginner', duration: '40 min', objectives: ['Initialize repositories and commits', 'Branching and merging workflows', 'Resolve merge conflicts confidently'] },
  { id: 'docker-basics', title: 'Docker Fundamentals', description: 'Containerize applications, write multi-stage Dockerfiles, manage images, volumes, and multi-service Docker Compose.', category: 'Containers', difficulty: 'beginner', duration: '45 min', objectives: ['Write optimized Dockerfiles', 'Manage containers and networks', 'Orchestrate stacks with Docker Compose'] },
  { id: 'kubernetes-basics', title: 'Kubernetes Orchestration', description: 'Master K8s Pods, Deployments, Services, Ingress TLS, ConfigMaps, Secrets, and Helm package management.', category: 'Observability', difficulty: 'intermediate', duration: '60 min', objectives: ['Deploy self-healing applications', 'Configure ClusterIP & Ingress routing', 'Manage secrets and Helm charts'] },
  { id: 'networking-fundamentals', title: 'Networking Fundamentals', description: 'Understand OSI layers, TCP/IP 3-way handshake, DNS records, HTTP/S, SSH tunneling, and load balancing.', category: 'Networking', difficulty: 'beginner', duration: '35 min', objectives: ['Analyze TCP/IP packets & handshake', 'Configure DNS A, CNAME & MX records', 'Set up SSH port forwarding tunnels'] },
  { id: 'cicd-pipelines', title: 'CI/CD Pipelines & Automation', description: 'Build automated continuous integration & deployment pipelines with GitHub Actions and automated testing.', category: 'CI/CD', difficulty: 'intermediate', duration: '50 min', objectives: ['Configure GitHub Actions workflows', 'Automate build & test triggers', 'Deploy artifacts to staging/production'] },
  { id: 'aws-cloud-essentials', title: 'AWS Cloud Essentials', description: 'Design 3-tier AWS architectures: EC2, VPC, S3, IAM, Auto Scaling, ALB, RDS, and SQS/SNS messaging.', category: 'Cloud', difficulty: 'intermediate', duration: '55 min', objectives: ['Provision VPC public/private subnets', 'Configure Auto Scaling & Load Balancer', 'IAM roles & least privilege security'] },
  { id: 'monitoring-observability', title: 'Monitoring & Observability', description: 'Set up Prometheus metrics collection, Grafana dashboards, log aggregation, and alerting rules.', category: 'Observability', difficulty: 'intermediate', duration: '45 min', objectives: ['Instrument app metrics for Prometheus', 'Build real-time Grafana dashboards', 'Configure Slack/PagerDuty alert triggers'] },
  { id: 'terraform-iac', title: 'Terraform Infrastructure as Code', description: 'Provision reproducible cloud infrastructure using HCL, modules, state management, and plan execution.', category: 'Infrastructure as Code', difficulty: 'advanced', duration: '50 min', objectives: ['Write declarative Terraform HCL', 'Manage remote backend state locks', 'Create reusable modular infrastructure'] },
  { id: 'system-design-scalability', title: 'System Design & Scalability', description: 'Architect high-availability systems with caching (Redis), database sharding, CDN, and load balancing.', category: 'System Design', difficulty: 'advanced', duration: '60 min', objectives: ['Design high-availability microservices', 'Implement Redis caching layers', 'Configure rate limiting & circuit breakers'] },
  { id: 'devsecops-security', title: 'DevSecOps & Cloud Security', description: 'Integrate security scanning (Trivy, SonarQube), secrets management, container hardening, and compliance.', category: 'Security', difficulty: 'advanced', duration: '45 min', objectives: ['Scan Docker images for vulnerabilities', 'Harden containers & no-root execution', 'Manage secrets with HashiCorp Vault'] },
  { id: 'endpoint-security', title: 'Enterprise Endpoint Security: EPP, EDR & XDR Defense', description: 'Comprehensive enterprise learning module covering EPP prevention, EDR continuous telemetry, XDR cross-layer correlation, Defender GPO rollout, CrowdStrike auto-isolation, and Intune BitLocker enforcement.', category: 'Security', difficulty: 'advanced', duration: '75 min', objectives: ['Differentiate EPP, EDR, and XDR', 'Deploy Defender via PowerShell/GPO', 'Configure CrowdStrike Falcon Auto-Isolation', 'Enforce BitLocker via Intune'] },
  { id: 'digital-forensics', title: 'Digital Forensics & Incident Response (DFIR) Masterclass', description: 'Scientific digital evidence preservation, chain of custody, Volatility memory analysis, Autopsy disk artifacts, Wireshark network forensics, and court-admissible reporting.', category: 'Security', difficulty: 'advanced', duration: '90 min', objectives: ['Master 5-stage scientific forensic methodology', 'Perform RAM memory analysis using Volatility 3', 'Extract NTFS $MFT & Registry artifacts', 'Maintain court-admissible Chain of Custody'] },
  { id: 'bash-automation', title: 'Advanced Bash Automation', description: 'Write production shell scripts with error handling, text processing (awk/sed), cron jobs, and CLI tools.', category: 'Automation', difficulty: 'intermediate', duration: '40 min', objectives: ['Write defensive Bash scripts (set -e)', 'Parse logs with awk, sed, and grep', 'Automate system cron maintenance'] },
  { id: 'python-devops-automation', title: 'Python Cloud Automation', description: 'Automate cloud tasks with Python 3, boto3 AWS SDK, REST API requests, subprocess, and log parsing.', category: 'Automation', difficulty: 'intermediate', duration: '45 min', objectives: ['Build AWS cloud automation scripts with boto3', 'Parse server access logs with regex', 'Execute system calls safely with subprocess'] },
  { id: 'gitops-argocd', title: 'GitOps & ArgoCD', description: 'Implement continuous deployment with Git as the single source of truth using ArgoCD and Kubernetes.', category: 'GitOps', difficulty: 'advanced', duration: '50 min', objectives: ['Install & configure ArgoCD controller', 'Sync K8s manifests from Git repos', 'Automate drift detection and rollback'] },
];

export default function DashboardPage() {
  const [units, setUnits] = useState(FALLBACK_UNITS);
  const [_loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedDifficulty, setSelectedDifficulty] = useState('all');

  useEffect(() => {
    async function loadUnits() {
      try {
        const res = await unitApi.list();
        if (res.data?.data && res.data.data.length > 0) {
          const sorted = res.data.data.sort((a, b) => (b.id === 'realworld-internship-case-study' ? 1 : -1));
          setUnits(sorted);
        }
      } catch (err) {
        console.warn('Using fallback local unit definitions:', err.message);
      } finally {
        setLoading(false);
      }
    }

    loadUnits();
  }, []);

  const filteredUnits = units.filter((unit) => {
    const matchesSearch =
      unit.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      unit.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || unit.category === selectedCategory;
    const matchesDifficulty =
      selectedDifficulty === 'all' || unit.difficulty === selectedDifficulty;
    return matchesSearch && matchesCategory && matchesDifficulty;
  });

  return (
    <div className="dashboard">
      <div className="container">
        {/* ── Stats Bar ──────────────────────────────────── */}
        <div className="dashboard-stats animate-fade-in">
          <div className="stat-card glass-card">
            <div className="stat-icon icon-cyan">
              <BookOpen size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{units.length}</span>
              <span className="stat-label">Learning Units</span>
            </div>
          </div>
          <div className="stat-card glass-card">
            <div className="stat-icon icon-green">
              <CheckCircle2 size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-value">3 Modes</span>
              <span className="stat-label">Learn • Practice • Prepare</span>
            </div>
          </div>
          <div className="stat-card glass-card">
            <div className="stat-icon icon-purple">
              <BarChart3 size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-value">100%</span>
              <span className="stat-label">Placement Ready</span>
            </div>
          </div>
          <div className="stat-card glass-card">
            <div className="stat-icon icon-orange">
              <Sparkles size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-value">AI Guided</span>
              <span className="stat-label">Smart Hints & Mentoring</span>
            </div>
          </div>
        </div>

        {/* ── FULL-WIDTH COURSE LIBRARY CATALOG ────────────────────── */}
        <div className="catalog-full-width animate-fade-in">
          <div className="catalog-panel-header">
            <div className="catalog-header-meta">
              <span className="badge-catalog">📚 Course Library</span>
            </div>
            <h2 className="catalog-panel-title">
              All Learning Units
              <span className="unit-count-badge">({filteredUnits.length})</span>
            </h2>
          </div>

          {/* Filters */}
          <div className="dashboard-filters">
            <div className="search-box">
              <Search size={18} className="search-icon" />
              <input
                type="text"
                className="input search-input"
                placeholder="Search DevOps topics (Linux, Docker, CI/CD)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="filter-group">
              <div className="category-pills">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    className={`pill ${selectedCategory === cat ? 'active' : ''}`}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="difficulty-filter">
                <Filter size={14} />
                <select
                  className="input difficulty-select"
                  value={selectedDifficulty}
                  onChange={(e) => setSelectedDifficulty(e.target.value)}
                >
                  <option value="all">All Levels</option>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </div>
            </div>
          </div>

          {/* Units Grid */}
          <div className="labs-grid stagger-children">
            {filteredUnits.map((unit) => (
              <div
                key={unit.id}
                className={`lab-card glass-card animate-fade-in-up ${unit.isCaseStudy ? 'case-study-card' : ''}`}
              >
                <div className="lab-card-header">
                  {unit.isCaseStudy ? (
                    <span className="badge badge-case-study">🌟 REAL INTERNSHIP CASE STUDY</span>
                  ) : (
                    <span className={`badge badge-${unit.difficulty}`}>{unit.difficulty}</span>
                  )}
                  <span className="lab-duration">
                    <Clock size={12} />
                    {unit.duration}
                  </span>
                </div>

                <div className="lab-card-body">
                  <h3 className="lab-card-title">{unit.title}</h3>
                  <p className="lab-card-desc">{unit.description}</p>

                  <div className="lab-objectives">
                    {unit.objectives?.slice(0, 3).map((obj, i) => (
                      <div key={i} className="lab-objective">
                        <CheckCircle2 size={12} />
                        <span>{obj}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3 Modes Action Buttons */}
                <div className="unit-modes-footer">
                  <Link
                    to={`/unit/${unit.id}/learn`}
                    className="mode-btn mode-learn"
                    title="Learn Theory"
                  >
                    <BookOpen size={14} />
                    <span>Learn</span>
                  </Link>
                  <Link
                    to={`/unit/${unit.id}/practice`}
                    className="mode-btn mode-practice"
                    title="Practice Lab Terminal — Live Cloud Sandbox Coming Soon"
                  >
                    <Terminal size={14} />
                    <span>Practice</span>
                    <span className="mode-soon-pill">Soon</span>
                  </Link>
                  <Link
                    to={`/unit/${unit.id}/prepare`}
                    className="mode-btn mode-prepare"
                    title="Interview Q&A Deck"
                  >
                    <Award size={14} />
                    <span>Prepare</span>
                  </Link>
                  {unit.isCaseStudy && (
                    <Link
                      to="/casestudies"
                      className="mode-btn mode-casestudy"
                      title="Real-World Production Case Study"
                    >
                      <Sparkles size={14} />
                      <span>Case Study</span>
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>

          {filteredUnits.length === 0 && (
            <div className="empty-state">
              <Terminal size={48} />
              <h3>No topics found</h3>
              <p>Try adjusting your search query or filters</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
