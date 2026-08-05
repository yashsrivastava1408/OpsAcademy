import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles,
  Award,
  Clock,
  ArrowRight,
  Compass,
} from 'lucide-react';
import DevOpsRoadmap from '../components/DevOpsRoadmap/DevOpsRoadmap';
import { unitApi } from '../services/api';
import './RoadmapPage.css';

const FALLBACK_UNITS = [
  { id: 'linux-basics', title: 'Linux Fundamentals', description: 'Master Linux CLI, file permissions, shell commands, process management, and system administration.', category: 'Linux', difficulty: 'beginner', duration: '30 min' },
  { id: 'git-basics', title: 'Git & GitHub Workflow', description: 'Master version control, branching, merging, interactive rebasing, merge conflicts, and Pull Requests.', category: 'Version Control', difficulty: 'beginner', duration: '40 min' },
  { id: 'docker-basics', title: 'Docker Fundamentals', description: 'Containerize applications, write multi-stage Dockerfiles, manage images, volumes, and multi-service Docker Compose.', category: 'Containers', difficulty: 'beginner', duration: '45 min' },
  { id: 'kubernetes-basics', title: 'Kubernetes Orchestration', description: 'Master K8s Pods, Deployments, Services, Ingress TLS, ConfigMaps, Secrets, and Helm package management.', category: 'Observability', difficulty: 'intermediate', duration: '60 min' },
  { id: 'networking-fundamentals', title: 'Networking Fundamentals', description: 'Understand OSI layers, TCP/IP 3-way handshake, DNS records, HTTP/S, SSH tunneling, and load balancing.', category: 'Networking', difficulty: 'beginner', duration: '35 min' },
  { id: 'cicd-pipelines', title: 'CI/CD Pipelines & Automation', description: 'Build automated continuous integration & deployment pipelines with GitHub Actions and automated testing.', category: 'CI/CD', difficulty: 'intermediate', duration: '50 min' },
  { id: 'aws-cloud-essentials', title: 'AWS Cloud Essentials', description: 'Design 3-tier AWS architectures: EC2, VPC, S3, IAM, Auto Scaling, ALB, RDS, and SQS/SNS messaging.', category: 'Cloud', difficulty: 'intermediate', duration: '55 min' },
  { id: 'monitoring-observability', title: 'Monitoring & Observability', description: 'Set up Prometheus metrics collection, Grafana dashboards, log aggregation, and alerting rules.', category: 'Observability', difficulty: 'intermediate', duration: '45 min' },
  { id: 'terraform-iac', title: 'Terraform Infrastructure as Code', description: 'Provision reproducible cloud infrastructure using HCL, modules, state management, and plan execution.', category: 'Infrastructure as Code', difficulty: 'advanced', duration: '50 min' },
  { id: 'system-design-scalability', title: 'System Design & Scalability', description: 'Architect high-availability systems with caching (Redis), database sharding, CDN, and load balancing.', category: 'System Design', difficulty: 'advanced', duration: '60 min' },
  { id: 'devsecops-security', title: 'DevSecOps & Cloud Security', description: 'Integrate security scanning (Trivy, SonarQube), secrets management, container hardening, and compliance.', category: 'Security', difficulty: 'advanced', duration: '45 min' },
  { id: 'bash-automation', title: 'Advanced Bash Automation', description: 'Write production shell scripts with error handling, text processing (awk/sed), cron jobs, and CLI tools.', category: 'Automation', difficulty: 'intermediate', duration: '40 min' },
  { id: 'python-devops-automation', title: 'Python Cloud Automation', description: 'Automate cloud tasks with Python 3, boto3 AWS SDK, REST API requests, subprocess, and log parsing.', category: 'Automation', difficulty: 'intermediate', duration: '45 min' },
  { id: 'gitops-argocd', title: 'GitOps & ArgoCD', description: 'Implement continuous deployment with Git as the single source of truth using ArgoCD and Kubernetes.', category: 'GitOps', difficulty: 'advanced', duration: '50 min' },
];

export default function RoadmapPage() {
  const [units, setUnits] = useState(FALLBACK_UNITS);
  const [activeWeekIndex, setActiveWeekIndex] = useState(0);

  useEffect(() => {
    async function loadUnits() {
      try {
        const res = await unitApi.list();
        if (res.data?.data && res.data.data.length > 0) {
          setUnits(res.data.data);
        }
      } catch (err) {
        console.warn('Using local unit definitions:', err.message);
      }
    }
    loadUnits();
  }, []);


  return (
    <div className="roadmap-page">
      <div className="container">
        {/* ── Hero Banner ───────────────────────────────────────── */}
        <div className="roadmap-hero-banner glass-card animate-fade-in">
          <div className="hero-banner-content">
            <div className="banner-badge">
              <Compass size={16} />
              <span>Structured Career Pathway</span>
            </div>
            <h1 className="banner-title">
              Complete 13-Week <span className="gradient-text">DevOps Engineering</span> Roadmap
            </h1>
            <p className="banner-subtitle">
              From beginner fundamentals to senior cloud & site reliability engineer. Follow this battle-tested weekly milestone timeline with live interactive labs.
            </p>

            <div className="banner-stats-row">
              <div className="banner-stat-pill">
                <Sparkles size={16} className="text-cyan" />
                <span>13 Weeks • 8 Stages</span>
              </div>
              <div className="banner-stat-pill">
                <Clock size={16} className="text-green" />
                <span>~208 Hours Practice</span>
              </div>
              <div className="banner-stat-pill">
                <Award size={16} className="text-purple" />
                <span>Placement Ready</span>
              </div>
            </div>
          </div>

          <div className="hero-banner-action">
            <Link to="/dashboard" className="btn btn-primary btn-lg">
              Explore All Labs
              <ArrowRight size={18} />
            </Link>
          </div>
        </div>

        {/* ── Dedicated Interactive CI/CD Pipeline Roadmap ─────── */}
        <div className="roadmap-main-deck animate-fade-in-up">
          <DevOpsRoadmap
            units={units}
            selectedStepIndex={activeWeekIndex}
            onStepSelect={(index) => setActiveWeekIndex(index)}
          />
        </div>
      </div>
    </div>
  );
}
