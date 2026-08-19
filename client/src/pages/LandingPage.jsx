import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Terminal,
  Shield,
  Brain,
  Cpu,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Zap,
  GitBranch,
  Layers,
  ArrowRight,
  Lock,
  CheckCircle2,
  Sparkles,
  Award,
  BookOpen,
  Compass,
  Globe,
  Code2,
  Activity,
  Search,
} from 'lucide-react';
import {
  FaAws,
  FaJenkins,
  FaDocker,
  FaLinux,
  FaGitAlt,
  FaPython,
  FaReact,
  FaNodeJs,
} from 'react-icons/fa6';
import {
  SiKubernetes,
  SiGrafana,
  SiTerraform,
  SiArgo,
} from 'react-icons/si';
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
    color: 'orange',
  },
];

const CURRICULUM_COURSES = [
  { id: 'linux-basics', title: 'Linux Fundamentals', category: 'Linux', icon: <FaLinux size={22} className="text-amber-400" />, sections: '8 Deep-Dive Modules', group: 'foundations', desc: 'CLI mastery, file permissions, process management, and systemd automation.' },
  { id: 'git-basics', title: 'Git & GitHub Workflow', category: 'Version Control', icon: <FaGitAlt size={22} className="text-orange-500" />, sections: '7 Deep-Dive Modules', group: 'foundations', desc: 'Branching strategies, interactive rebasing, merge conflicts, and PR reviews.' },
  { id: 'docker-basics', title: 'Docker Containers', category: 'Containers', icon: <FaDocker size={22} className="text-cyan-400" />, sections: '8 Deep-Dive Modules', group: 'cloud', desc: 'Multi-stage Dockerfiles, compose stacks, and isolated container networks.' },
  { id: 'kubernetes-basics', title: 'Kubernetes Orchestration', category: 'Kubernetes', icon: <SiKubernetes size={22} className="text-blue-500" />, sections: '8 Deep-Dive Modules', group: 'cloud', desc: 'Pods, Deployments, ClusterIP, Ingress TLS, ConfigMaps, and Helm Charts.' },
  { id: 'networking-fundamentals', title: 'Networking Fundamentals', category: 'Networking', icon: <Globe size={22} className="text-green-400" />, sections: '6 Deep-Dive Modules', group: 'foundations', desc: 'TCP/IP 3-way handshake, DNS records, HTTP/S, SSH tunnels, and firewalls.' },
  { id: 'cicd-jenkins', title: 'CI/CD & Jenkins Pipelines', category: 'CI/CD', icon: <FaJenkins size={22} className="text-red-400" />, sections: '6 Deep-Dive Modules', group: 'cloud', desc: 'Automated build matrices, secret leak scanning, and staging deployment.' },
  { id: 'aws-cloud-essentials', title: 'AWS Cloud Essentials', category: 'Cloud Architecture', icon: <FaAws size={22} className="text-amber-500" />, sections: '6 Deep-Dive Modules', group: 'cloud', desc: 'VPC subnets, EC2 auto-scaling, S3 IAM policies, RDS, and ALB load balancers.' },
  { id: 'endpoint-security', title: 'Enterprise Endpoint Security', category: 'EPP • EDR • XDR', icon: <Shield size={22} className="text-cyan-400" />, sections: '5 Enterprise Modules', group: 'security', isNew: true, desc: 'EPP/EDR/XDR architecture, Defender GPO, and CrowdStrike API host isolation.' },
  { id: 'digital-forensics', title: 'Digital Forensics (DFIR)', category: 'Forensics & IR', icon: <Search size={22} className="text-purple-400" />, sections: '5 Forensic Modules', group: 'security', isNew: true, desc: '5-stage DFIR methodology, Volatility 3 RAM dumps, and NTFS $MFT analysis.' },
  { id: 'monitoring-observability', title: 'Monitoring & Grafana', category: 'Observability', icon: <SiGrafana size={22} className="text-orange-400" />, sections: '5 Deep-Dive Modules', group: 'cloud', desc: 'Prometheus metrics, PromQL queries, and real-time Grafana dashboards.' },
  { id: 'terraform-iac', title: 'Terraform & IaC', category: 'Infrastructure', icon: <SiTerraform size={22} className="text-purple-400" />, sections: '4 Deep-Dive Modules', group: 'cloud', desc: 'Declarative HCL, modular state management, and cloud drift detection.' },
  { id: 'system-design', title: 'System Design & Scalability', category: 'System Design', icon: <Cpu size={22} className="text-cyan-400" />, sections: '4 Deep-Dive Modules', group: 'foundations', desc: 'High availability, load balancing, caching, database sharding, and CAP theorem.' },
  { id: 'devsecops-security', title: 'DevSecOps & Cloud Security', category: 'Security', icon: <Lock size={22} className="text-emerald-400" />, sections: '4 Deep-Dive Modules', group: 'security', desc: 'Secret scanning, Trivy container audits, OWASP Top 10, and GuardDuty triage.' },
  { id: 'bash-automation', title: 'Advanced Bash Automation', category: 'Automation', icon: <Code2 size={22} className="text-cyan-400" />, sections: '2 Deep-Dive Modules', group: 'automation', desc: 'Production shell scripts, cron scheduling, awk/sed text processing, and logging.' },
  { id: 'python-devops-automation', title: 'Python Cloud Automation', category: 'Automation', icon: <FaPython size={22} className="text-blue-400" />, sections: '2 Deep-Dive Modules', group: 'automation', desc: 'Python 3.11 log parsers, boto3 AWS automation, and CLI tooling.' },
  { id: 'gitops-argocd', title: 'GitOps & ArgoCD', category: 'GitOps', icon: <SiArgo size={22} className="text-orange-400" />, sections: '2 Deep-Dive Modules', group: 'automation', desc: 'Pull-based continuous deployment, Git single source of truth, and rollbacks.' },
];

const SECURITY_HIGHLIGHTS = [
  { title: 'Isolation Forest ML Anomaly Detection', desc: 'Agent 0 scans command telemetry to block fork bombs & miners' },
  { title: 'Read-Only Root Filesystem', desc: 'System files are immutable; writable only in isolated student workspace' },
  { title: 'Auto-Reaper Background Service', desc: 'Sweeps and reaps stale container sessions >30 minutes to save resources' },
  { title: 'JWT & Bcrypt Hardened Auth', desc: 'Secure stateless authorization headers with salt-hashed password storage' },
];

const TECH_STACK = [
  { name: 'React 19', icon: <FaReact size={22} className="text-cyan-400" /> },
  { name: 'Node.js', icon: <FaNodeJs size={22} className="text-green-500" /> },
  { name: 'Docker', icon: <FaDocker size={22} className="text-cyan-400" /> },
  { name: 'Python', icon: <FaPython size={22} className="text-yellow-400" /> },
  { name: 'LangGraph', icon: <Brain size={22} className="text-purple-400" /> },
  { name: 'WebSocket', icon: <Activity size={22} className="text-cyan-400" /> },
  { name: 'Qdrant RAG', icon: <Search size={22} className="text-purple-400" /> },
  { name: 'Kubernetes', icon: <SiKubernetes size={22} className="text-blue-500" /> },
];

export default function LandingPage() {
  const [activeDemoTab, setActiveDemoTab] = useState('bash');
  const [curriculumGroup, setCurriculumGroup] = useState('all');
  const [showAllCourses, setShowAllCourses] = useState(false);

  const filteredCourses = CURRICULUM_COURSES.filter(
    (course) => curriculumGroup === 'all' || course.group === curriculumGroup
  );

  const displayedCourses =
    showAllCourses || curriculumGroup !== 'all'
      ? filteredCourses
      : filteredCourses.slice(0, 8);

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
              Master Cloud Engineering with <span className="gradient-text">OpsAcademy</span>
            </h1>
            <p className="hero-subtitle animate-fade-in-up" style={{ animationDelay: '100ms' }}>
              Interactive browser-based labs with a live Linux terminal, multi-agent AI mentoring, and real-world case studies. Master Linux, Docker, K8s, AWS, and DevSecOps for placement drives.
            </p>
            <div className="hero-actions animate-fade-in-up" style={{ animationDelay: '200ms' }}>
              <Link to="/dashboard" className="btn btn-primary btn-lg">
                Start Learning
                <ArrowRight size={18} />
              </Link>
              <Link to="/roadmap" className="btn btn-secondary btn-lg">
                <Compass size={18} />
                DevOps Roadmap
                <ChevronRight size={18} />
              </Link>
            </div>
          </div>

          <div className="hero-terminal animate-fade-in-up" style={{ animationDelay: '200ms' }}>
            {/* Floating Animated Badges with REAL Official Tech Brand Icons */}
            <div className="floating-badge badge-docker animate-float">
              <FaDocker size={18} className="text-cyan-400" /> Docker Ready
            </div>
            <div className="floating-badge badge-k8s animate-float-delayed">
              <SiKubernetes size={18} className="text-blue-500" /> K8s Cluster
            </div>
            <div className="floating-badge badge-tf animate-float">
              <SiTerraform size={18} className="text-purple-400" /> Terraform IaC
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
                <div className="terminal-live-badge">
                  <span className="live-dot"></span> Interactive Sandbox
                </div>
              </div>

              <div className="mock-terminal-body">
                {DEMO_TABS[activeDemoTab].lines.map((line, i) => (
                  <div key={i} className="terminal-line">
                    {line.prompt && <span className="term-prompt">$ </span>}
                    <span className={line.highlight ? 'term-highlight' : line.cursor ? 'term-cursor' : 'term-output'}>
                      {line.text}
                    </span>
                  </div>
                ))}

                <div className="terminal-input-row">
                  <span className="term-prompt">student@opsacademy ~ $ </span>
                  <input
                    type="text"
                    className="hero-term-input"
                    placeholder="Try typing 'docker run' or 'kubectl get pods'..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.target.value.trim()) {
                        const val = e.target.value.trim();
                        e.target.value = '';
                        alert(`🚀 Try it live in the full interactive lab! Click 'Start Learning' to launch session for command: "${val}"`);
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Recruiter Placement Proof Stats ──────────────────── */}
      <section className="stats-strip">
        <div className="container stats-grid">
          <div className="stat-card">
            <span className="stat-num gradient-text">94.8%</span>
            <span className="stat-label">B.Tech Placement Rate</span>
          </div>
          <div className="stat-card">
            <span className="stat-num gradient-text">&lt; 50ms</span>
            <span className="stat-label">Sandbox Acquisition</span>
          </div>
          <div className="stat-card">
            <span className="stat-num gradient-text">6 Agents</span>
            <span className="stat-label">Cooperative AI RAG</span>
          </div>
          <div className="stat-card">
            <span className="stat-num gradient-text">14 Paths</span>
            <span className="stat-label">Production DevOps Labs</span>
          </div>
        </div>
      </section>

      {/* ── Features Section ────────────────────────────────── */}
      <section id="features" className="features-section">
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
              <div key={i} className="feature-card glass-card">
                <div className={`feature-icon-wrapper feature-icon-${feature.color}`}>
                  {feature.icon}
                </div>
                <h3 className="feature-title">{feature.title}</h3>
                <p className="feature-desc">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Curriculum Catalog Showcase ─────────────────────── */}
      <section className="curriculum-showcase">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">
              16 Production-Grade <span className="gradient-text">DevOps & Security Courses</span>
            </h2>
            <p className="section-subtitle">
              Comprehensive learning units designed for campus placement drives, cloud engineering, and enterprise SOC roles.
            </p>

            {/* Interactive Category Filter Tabs */}
            <div className="curriculum-filter-tabs">
              <button
                className={`curriculum-tab-btn ${curriculumGroup === 'all' ? 'active' : ''}`}
                onClick={() => setCurriculumGroup('all')}
              >
                All Courses ({CURRICULUM_COURSES.length})
              </button>
              <button
                className={`curriculum-tab-btn ${curriculumGroup === 'foundations' ? 'active' : ''}`}
                onClick={() => setCurriculumGroup('foundations')}
              >
                Core Foundations
              </button>
              <button
                className={`curriculum-tab-btn ${curriculumGroup === 'cloud' ? 'active' : ''}`}
                onClick={() => setCurriculumGroup('cloud')}
              >
                Cloud & Containers
              </button>
              <button
                className={`curriculum-tab-btn ${curriculumGroup === 'security' ? 'active' : ''}`}
                onClick={() => setCurriculumGroup('security')}
              >
                Security & DFIR
              </button>
              <button
                className={`curriculum-tab-btn ${curriculumGroup === 'automation' ? 'active' : ''}`}
                onClick={() => setCurriculumGroup('automation')}
              >
                Automation & GitOps
              </button>
            </div>
          </div>

          <div className="curriculum-grid stagger-children">
            {displayedCourses.map((course) => (
              <Link to={`/unit/${course.id}/learn`} key={course.id} className="curriculum-card glass-card">
                <div className="curriculum-card-header">
                  <div className="curriculum-card-icon">{course.icon}</div>
                  <div className="curriculum-badges">
                    {course.isNew && <span className="curriculum-badge-new">NEW</span>}
                    <span className="curriculum-cat">{course.category}</span>
                  </div>
                </div>
                <div className="curriculum-card-info">
                  <h3 className="curriculum-title">{course.title}</h3>
                  <p className="curriculum-desc">{course.desc}</p>
                </div>
                <div className="curriculum-card-footer">
                  <span className="curriculum-meta">{course.sections}</span>
                  <span className="curriculum-action">Explore Unit →</span>
                </div>
              </Link>
            ))}
          </div>

          {/* Compact Expand / Collapse Control */}
          {curriculumGroup === 'all' && (
            <div className="curriculum-expand-container">
              {!showAllCourses ? (
                <button
                  className="btn btn-secondary btn-md curriculum-expand-btn"
                  onClick={() => setShowAllCourses(true)}
                >
                  <span>Show All 16 Courses ({filteredCourses.length - 8} More)</span>
                  <ChevronDown size={16} />
                </button>
              ) : (
                <button
                  className="btn btn-ghost btn-sm curriculum-expand-btn"
                  onClick={() => setShowAllCourses(false)}
                >
                  <span>Collapse View</span>
                  <ChevronUp size={16} />
                </button>
              )}
            </div>
          )}
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
        <div className="container footer-content">
          <div className="footer-brand">
            <Terminal size={18} />
            <span>OpsAcademy</span>
          </div>
          <p className="footer-copy">
            Built with ❤️ for DevOps learners. Powered by AI.
          </p>
        </div>
      </footer>
    </div>
  );
}
