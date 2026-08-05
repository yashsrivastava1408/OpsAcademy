import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Terminal,
  Brain,
  CheckCircle2,
  Sparkles,
  Layers,
  Award,
  Zap,
  Play,
  Pause,
  Check,
} from 'lucide-react';
import './DevOpsRoadmap.css';

export const ROADMAP_DATA = [
  {
    stage: '01',
    week: 'Week 1',
    title: 'Python & Go Automation',
    subtitle: 'Select a Programming Language',
    category: 'Automation',
    color: 'cyan',
    icon: <Terminal size={16} />,
    description: 'Master core programming structures, exception handling, regex log parsing, file operations, and cloud SDKs (boto3) for DevOps automation.',
    skills: ['Python 3.11+', 'GoLang Basics', 'Regex Log Parsing', 'boto3 SDK'],
    linkedUnitIds: ['python-devops-automation'],
    estimatedHours: '15 hrs',
  },
  {
    stage: '02',
    week: 'Week 2',
    title: 'OS Concepts & Networking',
    subtitle: 'System Architecture & Network Protocols',
    category: 'Networking',
    color: 'purple',
    icon: <Layers size={16} />,
    description: 'Understand OS internals (Processes, Threads, CPU scheduling, Memory), Virtualization types, and network protocols (TCP/IP, HTTP/S, DNS, SSH, SSL/TLS).',
    skills: ['OS Memory', 'TCP 3-Way Handshake', 'DNS Records', 'SSH Tunneling'],
    linkedUnitIds: ['linux-basics', 'networking-fundamentals'],
    estimatedHours: '20 hrs',
  },
  {
    stage: '03',
    week: 'Week 3',
    title: 'Linux Systems & Shell Scripting',
    subtitle: 'Live Terminal Mastery & Bash Automation',
    category: 'Linux',
    color: 'green',
    icon: <Terminal size={16} />,
    description: 'Live in the Linux terminal. Master package managers, systemd services, cron job scheduling, file permissions (chmod/chown), and production Bash scripts.',
    skills: ['Bash Scripts', 'Systemd Services', 'Cron Jobs', 'File Permissions'],
    linkedUnitIds: ['linux-basics', 'bash-automation'],
    estimatedHours: '25 hrs',
  },
  {
    stage: '04',
    week: 'Week 4',
    title: 'Git & SCM Workflows',
    subtitle: 'Version Control with Git & GitHub',
    category: 'Version Control',
    color: 'orange',
    icon: <Zap size={16} />,
    description: 'Master collaborative Git workflows: branching strategies, resolving merge conflicts, interactive rebasing, stashing, cherry-picking, and Pull Request reviews.',
    skills: ['Git Branching', 'Interactive Rebase', 'Git Stash', 'GitHub PR Reviews'],
    linkedUnitIds: ['git-basics'],
    estimatedHours: '18 hrs',
  },
  {
    stage: '05',
    week: 'Week 5-7',
    title: 'AWS Cloud Architecture',
    subtitle: 'AWS Infrastructure Essentials',
    category: 'Cloud',
    color: 'blue',
    icon: <Sparkles size={16} />,
    description: 'Design highly available 3-tier cloud architectures on AWS. Provision EC2, VPC subnets, S3 buckets, RDS databases, IAM security roles, SQS/SNS, and ALB.',
    skills: ['AWS VPC Subnets', 'EC2 Auto Scaling', 'S3 Storage', 'IAM Privilege'],
    linkedUnitIds: ['aws-cloud-essentials'],
    estimatedHours: '35 hrs',
  },
  {
    stage: '06',
    week: 'Week 8-9',
    title: 'Docker Containerization',
    subtitle: 'Building & Packaging Containers',
    category: 'Containers',
    color: 'cyan',
    icon: <Layers size={16} />,
    description: 'Package applications into ultra-lightweight Docker containers. Write multi-stage Dockerfiles, compose multi-service stacks, and isolate network subnets.',
    skills: ['Dockerfile Best Practice', 'Multi-stage Builds', 'Docker Compose'],
    linkedUnitIds: ['docker-basics'],
    estimatedHours: '25 hrs',
  },
  {
    stage: '07',
    week: 'Week 10-12',
    title: 'Kubernetes Orchestration',
    subtitle: 'Container Deployment & Scaling',
    category: 'Orchestration',
    color: 'green',
    icon: <Award size={16} />,
    description: 'Orchestrate production container workloads. Manage Pods, Deployments, ReplicaSets, ClusterIP/NodePort Services, Ingress TLS routing, ConfigMaps, Secrets, and Helm Charts.',
    skills: ['K8s Manifests', 'Self-Healing', 'Ingress TLS', 'Helm Charts'],
    linkedUnitIds: ['kubernetes-basics'],
    estimatedHours: '40 hrs',
  },
  {
    stage: '08',
    week: 'Week 13',
    title: 'IaC, Observability & GitOps',
    subtitle: 'Terraform, Prometheus & ArgoCD',
    category: 'Infrastructure as Code',
    color: 'purple',
    icon: <CheckCircle2 size={16} />,
    description: 'Automate cloud infrastructure with Terraform IaC, set up Prometheus & Grafana monitoring dashboards, implement DevSecOps security, and deploy with ArgoCD GitOps.',
    skills: ['Terraform HCL', 'Prometheus/Grafana', 'ArgoCD GitOps'],
    linkedUnitIds: ['terraform-iac', 'monitoring-observability', 'gitops-argocd', 'devsecops-security'],
    estimatedHours: '30 hrs',
  },
];

export default function DevOpsRoadmap({ units = [], onStepSelect, selectedStepIndex }) {
  const [internalStep, setInternalStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const activeStep = selectedStepIndex !== undefined && selectedStepIndex !== null
    ? selectedStepIndex
    : internalStep;

  useEffect(() => {
    let interval;
    if (isPlaying) {
      interval = setInterval(() => {
        const nextIndex = (activeStep + 1) % ROADMAP_DATA.length;
        setInternalStep(nextIndex);
        if (onStepSelect) {
          onStepSelect(nextIndex, ROADMAP_DATA[nextIndex]);
        }
      }, 3500);
    }
    return () => clearInterval(interval);
  }, [isPlaying, activeStep, onStepSelect]);

  const handleStageClick = (index) => {
    setIsPlaying(false);
    setInternalStep(index);
    if (onStepSelect) {
      onStepSelect(index, ROADMAP_DATA[index]);
    }
  };

  const getUnitInfo = (unitId) => {
    return units.find((u) => u.id === unitId) || { id: unitId, title: unitId, category: 'DevOps' };
  };

  return (
    <div className="vertical-pipeline-card glass-card">
      {/* ── Pipeline Header Bar ───────────────────────────────────────── */}
      <div className="pipeline-header-vertical">
        <div className="pipeline-title-group">
          <div className="pipeline-status-badge">
            <span className="live-dot" />
            <span>CI/CD Pipeline Pathway</span>
          </div>
          <h3 className="pipeline-main-title">13-Week DevOps Pipeline</h3>
        </div>

        <button
          className={`pipeline-tour-btn ${isPlaying ? 'playing' : ''}`}
          onClick={() => setIsPlaying(!isPlaying)}
        >
          {isPlaying ? <Pause size={13} /> : <Play size={13} />}
          <span>{isPlaying ? 'Pause' : 'Auto Run'}</span>
        </button>
      </div>

      {/* ── Vertical CI/CD Pipeline Stages Track (Full Stretched Height) ── */}
      <div className="vertical-stages-track-stretched">
        {ROADMAP_DATA.map((step, index) => {
          const isActive = index === activeStep;
          return (
            <div key={step.stage} className="vertical-stage-wrapper">
              <button
                className={`vertical-stage-node node-${step.color} ${isActive ? 'active' : ''}`}
                onClick={() => handleStageClick(index)}
              >
                <div className="stage-top-meta">
                  <span className="stage-num">STAGE {step.stage} • {step.week}</span>
                  <span className="stage-status-check">
                    <Check size={10} />
                  </span>
                </div>

                <div className="stage-body">
                  <div className="stage-icon">{step.icon}</div>
                  <div className="stage-text">
                    <h4 className="stage-title">{step.title}</h4>
                    <span className="stage-subtitle">{step.subtitle}</span>
                  </div>
                </div>

                {/* Skill Chips */}
                <div className="stage-skills-mini">
                  {step.skills.slice(0, 3).map((skill, i) => (
                    <span key={i} className="mini-chip">
                      <CheckCircle2 size={10} className="check-icon" />
                      {skill}
                    </span>
                  ))}
                </div>

                {/* 1-Click Launchers directly inside stage node */}
                <div className="stage-quick-launchers">
                  {step.linkedUnitIds.slice(0, 1).map((unitId) => {
                    const unit = getUnitInfo(unitId);
                    return (
                      <div key={unitId} className="stage-launch-row">
                        <span className="unit-label">{unit.title}</span>
                        <div className="launch-btns flex-gap">
                          <Link to={`/unit/${unitId}/learn`} className="btn-launch btn-learn">
                            <BookOpen size={11} /> Learn
                          </Link>
                          <Link to={`/unit/${unitId}/practice`} className="btn-launch btn-practice">
                            <Terminal size={11} /> Practice
                          </Link>
                          <Link to={`/unit/${unitId}/prepare`} className="btn-launch btn-prepare">
                            <Brain size={11} /> Prepare
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {isActive && <div className="stage-glow-beam" />}
              </button>

              {index < ROADMAP_DATA.length - 1 && (
                <div className={`vertical-connector ${isActive ? 'active-flow' : ''}`}>
                  <div className="vertical-laser-particle" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
