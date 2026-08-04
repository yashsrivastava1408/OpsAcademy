import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Terminal,
  Shield,
  Brain,
  Cpu,
  ChevronRight,
  Zap,
  GitBranch,
  Layers,
  ArrowRight,
  Lock,
  CheckCircle2,
  Sparkles,
  Award,
  BookOpen,
} from 'lucide-react';
import './LandingPage.css';

const DEMO_TABS = {
  bash: {
    label: 'terminal.sh',
    lines: [
      { prompt: true, text: 'mkdir -p /home/student/app' },
      { prompt: true, text: 'echo "<h1>Hello DevOps!</h1>" > /home/student/app/index.html' },
      { prompt: true, text: 'nginx -t' },
      { prompt: false, text: 'nginx: configuration file /etc/nginx/nginx.conf test is successful' },
      { prompt: true, text: 'curl localhost:80' },
      { prompt: false, text: '<h1>Hello DevOps!</h1>', highlight: true },
      { prompt: true, text: '█', cursor: true },
    ],
  },
  docker: {
    label: 'docker-compose.yml',
    lines: [
      { prompt: false, text: 'version: "3.8"' },
      { prompt: false, text: 'services:' },
      { prompt: false, text: '  web:' },
      { prompt: false, text: '    image: nginx:alpine', highlight: true },
      { prompt: false, text: '    ports:' },
      { prompt: false, text: '      - "8080:80"' },
      { prompt: false, text: '  db:' },
      { prompt: false, text: '    image: postgres:15-alpine' },
      { prompt: false, text: '    environment:' },
      { prompt: false, text: '      POSTGRES_PASSWORD: pass', highlight: true },
    ],
  },
  terraform: {
    label: 'main.tf',
    lines: [
      { prompt: false, text: 'resource "aws_instance" "web" {' },
      { prompt: false, text: '  ami           = "ami-0c55b159cbfafe1f0"' },
      { prompt: false, text: '  instance_type = "t3.micro"', highlight: true },
      { prompt: false, text: '  tags = {' },
      { prompt: false, text: '    Name        = "OpsAcademy-Prod"' },
      { prompt: false, text: '    Environment = "Production"' },
      { prompt: false, text: '  }' },
      { prompt: false, text: '}' },
    ],
  },
  k8s: {
    label: 'k8s-pod.yaml',
    lines: [
      { prompt: false, text: 'apiVersion: apps/v1' },
      { prompt: false, text: 'kind: Deployment' },
      { prompt: false, text: 'metadata:' },
      { prompt: false, text: '  name: web-app' },
      { prompt: false, text: 'spec:' },
      { prompt: false, text: '  replicas: 3', highlight: true },
      { prompt: false, text: '  template:' },
      { prompt: false, text: '    spec:' },
      { prompt: false, text: '      containers:' },
      { prompt: false, text: '      - name: nginx' },
      { prompt: false, text: '        image: nginx:1.25-alpine' },
    ],
  },
};

const FEATURES = [
  {
    icon: <Terminal size={24} />,
    title: 'Live Terminal',
    description: 'Real Linux shell in your browser via WebSocket streaming (<50ms latency). Execute commands, write scripts, and build infrastructure live.',
    color: 'cyan',
  },
  {
    icon: <Brain size={24} />,
    title: 'Multi-Agent AI Mentor',
    description: '4-agent RAG pipeline (LangGraph + Qdrant) that inspects your environment and provides hints without giving away the direct answer.',
    color: 'purple',
  },
  {
    icon: <Shield size={24} />,
    title: 'Sandbox Security',
    description: 'Isolated containers with cgroup memory caps (256MB), CPU limits (0.5 cores), read-only rootfs, and non-root execution.',
    color: 'green',
  },
  {
    icon: <Zap size={24} />,
    title: 'Auto-Grading Verification',
    description: 'Automated test suite executing checks inside active sandboxes. Evaluates outputs and returns instant step-by-step verification.',
  },
];

const CURRICULUM_COURSES = [
  { title: 'Linux Fundamentals', category: 'Linux', icon: '🐧', sections: '8 Deep-Dive Modules' },
  { title: 'Git & GitHub Workflow', category: 'Version Control', icon: '🔀', sections: '7 Deep-Dive Modules' },
  { title: 'Docker Fundamentals', category: 'Containers', icon: '🐳', sections: '8 Deep-Dive Modules' },
  { title: 'Kubernetes Orchestration', category: 'Kubernetes', icon: '☸️', sections: '8 Deep-Dive Modules' },
  { title: 'Networking Fundamentals', category: 'Networking', icon: '🌐', sections: '6 Deep-Dive Modules' },
  { title: 'CI/CD Pipelines', category: 'CI/CD', icon: '⚡', sections: '6 Deep-Dive Modules' },
  { title: 'AWS Cloud Essentials', category: 'Cloud', icon: '☁️', sections: '6 Deep-Dive Modules' },
  { title: 'Monitoring & Observability', category: 'Observability', icon: '📊', sections: '5 Deep-Dive Modules' },
  { title: 'Terraform & IaC', category: 'Infrastructure', icon: '🏗️', sections: '4 Deep-Dive Modules' },
  { title: 'System Design & Scalability', category: 'System Design', icon: '⚡', sections: '4 Deep-Dive Modules' },
  { title: 'DevSecOps & Security', category: 'Security', icon: '🔒', sections: '2 Deep-Dive Modules' },
  { title: 'Advanced Bash Automation', category: 'Automation', icon: '🐚', sections: '2 Deep-Dive Modules' },
  { title: 'Python Cloud Automation', category: 'Automation', icon: '🐍', sections: '2 Deep-Dive Modules' },
  { title: 'GitOps & ArgoCD', category: 'GitOps', icon: '🐙', sections: '2 Deep-Dive Modules' },
];

const SECURITY_HIGHLIGHTS = [
  { title: 'Isolation Forest ML Anomaly Detection', desc: 'Agent 0 scans command telemetry to block fork bombs & miners' },
  { title: 'Read-Only Root Filesystem', desc: 'System files are immutable; writable only in isolated student workspace' },
  { title: 'Auto-Reaper Background Service', desc: 'Sweeps and reaps stale container sessions >30 minutes to save resources' },
  { title: 'JWT & Bcrypt Hardened Auth', desc: 'Secure stateless authorization headers with salt-hashed password storage' },
];

const TECH_STACK = [
  { name: 'React 19', icon: '⚛️' },
  { name: 'Node.js', icon: '🟢' },
  { name: 'Docker', icon: '🐳' },
  { name: 'Python', icon: '🐍' },
  { name: 'LangGraph', icon: '🧠' },
  { name: 'WebSocket', icon: '🔌' },
  { name: 'Qdrant RAG', icon: '🔍' },
  { name: 'Kubernetes', icon: '☸️' },
];



export default function LandingPage() {
  const [activeDemoTab, setActiveDemoTab] = useState('bash');

  // Auto-rotate terminal tabs every 3.5 seconds
  useEffect(() => {
    const tabKeys = Object.keys(DEMO_TABS);
    const interval = setInterval(() => {
      setActiveDemoTab((currentTab) => {
        const currentIndex = tabKeys.indexOf(currentTab);
        const nextIndex = (currentIndex + 1) % tabKeys.length;
        return tabKeys[nextIndex];
      });
    }, 3500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="landing">
      {/* ── Hero Section ───────────────────────────────────── */}
      <section className="hero">
        <div className="hero-bg-orbs">
          <div className="orb orb-1"></div>
          <div className="orb orb-2"></div>
          <div className="orb orb-3"></div>
        </div>

        <div className="container hero-content">
          <div className="hero-text">
            <div className="hero-badge animate-fade-in">
              <Cpu size={14} />
              AI-Powered DevOps Learning Platform
            </div>
            <h1 className="hero-title animate-fade-in-up">
              Learn DevOps by <span className="gradient-text">Doing</span>,
              <br />
              Not Watching
            </h1>
            <p className="hero-subtitle animate-fade-in-up" style={{ animationDelay: '100ms' }}>
              Interactive, browser-based labs with a live Linux terminal.
              A multi-agent AI mentor guides you without giving away the solution.
              Master Linux, Docker, Git, and Kubernetes for placement interviews.
            </p>
            <div className="hero-actions animate-fade-in-up" style={{ animationDelay: '200ms' }}>
              <Link to="/dashboard" className="btn btn-primary btn-lg">
                Start Learning
                <ArrowRight size={18} />
              </Link>
              <a href="#features" className="btn btn-secondary btn-lg">
                Explore Platform
                <ChevronRight size={18} />
              </a>
            </div>
            <div className="hero-stats animate-fade-in-up" style={{ animationDelay: '300ms' }}>
              <div className="hero-stat">
                <span className="hero-stat-value">14</span>
                <span className="hero-stat-label">A-to-Z Courses</span>
              </div>
              <div className="hero-stat-divider"></div>
              <div className="hero-stat">
                <span className="hero-stat-value">&lt;50ms</span>
                <span className="hero-stat-label">Terminal Latency</span>
              </div>
              <div className="hero-stat-divider"></div>
              <div className="hero-stat">
                <span className="hero-stat-value">100%</span>
                <span className="hero-stat-label">Sandboxed</span>
              </div>
            </div>
          </div>

          <div className="hero-terminal animate-fade-in-up" style={{ animationDelay: '200ms' }}>
            {/* Floating Animated Badges */}
            <div className="floating-badge badge-docker animate-float">
              <span>🐳</span> Docker Ready
            </div>
            <div className="floating-badge badge-k8s animate-float-delayed">
              <span>☸️</span> K8s Cluster
            </div>
            <div className="floating-badge badge-tf animate-float">
              <span>🏗️</span> Terraform IaC
            </div>

            <div className="mock-terminal neon-border-glow">
              <div className="mock-terminal-header">
                <div className="terminal-dots">
                  <span className="terminal-dot red"></span>
                  <span className="terminal-dot yellow"></span>
                  <span className="terminal-dot green"></span>
                </div>
                <div className="terminal-tabs">
                  {Object.keys(DEMO_TABS).map((tabKey) => (
                    <button
                      key={tabKey}
                      className={`terminal-tab-btn ${activeDemoTab === tabKey ? 'active' : ''}`}
                      onClick={() => setActiveDemoTab(tabKey)}
                    >
                      {DEMO_TABS[tabKey].label}
                    </button>
                  ))}
                </div>
                <div className="terminal-status-pill">
                  <span className="status-dot"></span> Live PTY
                </div>
              </div>
              <div className="mock-terminal-body">
                {DEMO_TABS[activeDemoTab].lines.map((line, i) => (
                  <div key={i} className={`mock-line ${line.highlight ? 'highlight' : ''} ${line.cursor ? 'cursor-line' : ''}`}>
                    {line.prompt && <span className="mock-prompt">$ </span>}
                    <span className={line.cursor ? 'blink-cursor' : ''}>{line.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features Section ───────────────────────────────── */}
      <section className="features" id="features">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">
              Everything You Need to <span className="gradient-text">Crack DevOps Placements</span>
            </h2>
            <p className="section-subtitle">
              A 3-mode learning system with real infrastructure, AI tutoring, and automated assessment.
            </p>
          </div>

          <div className="features-grid stagger-children">
            {FEATURES.map((feature, i) => (
              <div key={i} className="feature-card glass-card animate-fade-in-up">
                <div className={`feature-icon icon-${feature.color}`}>
                  {feature.icon}
                </div>
                <h3 className="feature-title">{feature.title}</h3>
                <p className="feature-desc">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 14 Courses Showcase Section ──────────────────────── */}
      <section className="curriculum-section">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">
              Complete <span className="gradient-text">A-to-Z DevOps Curriculum</span>
            </h2>
            <p className="section-subtitle">
              14 production-grade courses designed for campus placement drives and cloud engineering roles.
            </p>
          </div>

          <div className="curriculum-grid stagger-children">
            {CURRICULUM_COURSES.map((course, i) => (
              <div key={i} className="curriculum-card glass-card animate-fade-in-up">
                <div className="curriculum-card-icon">{course.icon}</div>
                <div className="curriculum-card-info">
                  <span className="curriculum-cat">{course.category}</span>
                  <h4 className="curriculum-title">{course.title}</h4>
                  <span className="curriculum-meta">{course.sections}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 3-Mode Engine Spotlight Section ───────────────────── */}
      <section className="modes-spotlight-section">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">
              A Structured <span className="gradient-text">3-Mode Learning Engine</span>
            </h2>
            <p className="section-subtitle">
              Every course unit features 3 specialized modes to transform novices into placement-ready cloud engineers.
            </p>
          </div>

          <div className="modes-grid stagger-children">
            <div className="mode-spotlight-card glass-card mode-border-cyan animate-fade-in-up">
              <div className="mode-badge-pill pill-cyan">Mode 1: Learn</div>
              <div className="mode-card-icon icon-cyan">
                <BookOpen size={28} />
              </div>
              <h3 className="mode-card-title">Interactive Theory & Quizzes</h3>
              <p className="mode-card-desc">
                Step-by-step interactive theory with Mermaid.js architecture diagrams, real-world analogies, and concept-check quizzes.
              </p>
            </div>

            <div className="mode-spotlight-card glass-card mode-border-green animate-fade-in-up">
              <div className="mode-badge-pill pill-green">Mode 2: Practice</div>
              <div className="mode-card-icon icon-green">
                <Terminal size={28} />
              </div>
              <h3 className="mode-card-title">Live Sandboxed Terminal</h3>
              <p className="mode-card-desc">
                Real Linux & Docker terminal environment in your browser with automated verification checks and AI mentoring support.
              </p>
            </div>

            <div className="mode-spotlight-card glass-card mode-border-orange animate-fade-in-up">
              <div className="mode-badge-pill pill-orange">Mode 3: Prepare</div>
              <div className="mode-card-icon icon-orange">
                <Award size={28} />
              </div>
              <h3 className="mode-card-title">Placement Q&A & Flashcards</h3>
              <p className="mode-card-desc">
                Interactive 3D flip card decks and top recruiter model answers covering high-frequency campus placement interview scenarios.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Security Architecture Section ──────────────────── */}
      <section className="security-section">
        <div className="container">
          <div className="security-card glass-card">
            <div className="security-header">
              <div className="security-title-area">
                <Lock size={22} className="security-icon" />
                <h3>Enterprise Security & Sandbox Isolation</h3>
              </div>
              <span className="security-badge-indicator">
                <Sparkles size={12} /> Defense-in-Depth
              </span>
            </div>

            <div className="security-grid">
              {SECURITY_HIGHLIGHTS.map((item, i) => (
                <div key={i} className="security-item">
                  <CheckCircle2 size={16} className="security-check" />
                  <div>
                    <h4>{item.title}</h4>
                    <p>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Architecture Section ───────────────────────────── */}
      <section className="architecture">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">
              Built with <span className="gradient-text">Modern Microservices</span>
            </h2>
            <p className="section-subtitle">
              Production-grade architecture with pluggable sandbox engine & multi-agent AI pipeline.
            </p>
          </div>

          <div className="tech-stack-grid">
            {TECH_STACK.map((tech, i) => (
              <div key={i} className="tech-badge glass-card">
                <span className="tech-icon">{tech.icon}</span>
                <span className="tech-name">{tech.name}</span>
              </div>
            ))}
          </div>

          <div className="arch-diagram glass-card">
            <div className="arch-layer">
              <div className="arch-box arch-client">
                <Layers size={18} />
                <span>React 19 + xterm.js</span>
                <small>Browser Client</small>
              </div>
            </div>
            <div className="arch-arrow">↓ WebSocket + REST</div>
            <div className="arch-layer arch-layer-split">
              <div className="arch-box arch-gateway">
                <GitBranch size={18} />
                <span>Node.js Gateway</span>
                <small>Express + WS + Strategy Sandbox</small>
              </div>
              <div className="arch-box arch-ai">
                <Brain size={18} />
                <span>AI Agent Hub</span>
                <small>Python Flask + LangGraph</small>
              </div>
            </div>
            <div className="arch-arrow">↓ Docker Socket / PTY</div>
            <div className="arch-layer">
              <div className="arch-box arch-sandbox">
                <Shield size={18} />
                <span>Sandboxed Containers</span>
                <small>Alpine Linux + cgroups</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA Section ────────────────────────────────────── */}
      <section className="cta">
        <div className="container">
          <div className="cta-card glass-card">
            <h2 className="cta-title">
              Ready to <span className="gradient-text">Build Real Infrastructure</span>?
            </h2>
            <p className="cta-subtitle">
              Stop watching tutorials. Start typing commands.
            </p>
            <Link to="/dashboard" className="btn btn-primary btn-lg">
              Open Learning Dashboard
              <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="footer">
        <div className="container footer-inner">
          <div className="footer-brand">
            <Terminal size={16} />
            <span>OpsAcademy</span>
          </div>
          <p className="footer-text">
            Built with ❤️ for DevOps learners. Powered by AI.
          </p>
        </div>
      </footer>
    </div>
  );
}
