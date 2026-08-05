<div align="center">

# OpsAcademy

### AI-Driven DevOps Sandbox Learning Platform

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

**Learn DevOps by doing, not watching.** OpsAcademy is an interactive, browser-based learning platform where students master cloud engineering through a 3-mode learning system (Learn, Practice, Prepare) featuring live sandboxed terminals and AI-powered mentoring.

[Live Demo](#) | [Architecture](#architecture) | [Quick Start](#quick-start) | [Tech Stack](#tech-stack)

</div>

---

## Key Features

| Feature | Description |
|---|---|
| **14 A-to-Z DevOps Courses** | Comprehensive curriculum covering Linux, Git, Docker, Kubernetes, Networking, CI/CD, AWS Cloud, Monitoring, Terraform IaC, System Design, DevSecOps, Bash, Python, and GitOps |
| **3-Mode Learning System** | Learn (theory & concept quizzes), Practice (live terminal lab), and Prepare (flashcards & placement Q&A) for every unit |
| **Mermaid.js Diagram Engine** | Client-side interactive vector diagrams (flowcharts, sequence diagrams, architecture maps) with dark-theme styling |
| **Live Terminal** | Real Linux shell in the browser via `xterm.js` + WebSocket streaming with <50ms latency |
| **AI Mentor** | Multi-agent RAG system (LangGraph + Qdrant) that reads container state and provides hints — never direct answers |
| **Sandbox Security** | Isolated containers with cgroup memory/CPU limits, read-only rootfs, and network sub-bridging |
| **Auto-Grading Verification** | Automated verification engine executing shell test commands inside active sandboxes |
| **Dual-Mode Engine** | Pluggable sandbox backend: `node-pty` for cloud deployment, `dockerode` for production Docker isolation |
| **Auto-Reaper Cleanup** | Background process that automatically cleans up stale sandbox sessions older than 30 minutes |
| **Anti-Abuse Detection** | Isolation Forest ML model + regex pipeline to block fork bombs, crypto miners, and host-escape exploits |
| **College Placement Readiness** | Structured 3-mode curriculum designed for campus bootcamps, TPO reporting, and technical interview prep |

---

## Architecture

### High-Level System Design

```mermaid
graph TB
    subgraph Client["Browser Client"]
        UI[React + Vite]
        XT[xterm.js Terminal]
        MC[AI Mentor Chat]
        MODES[Learn / Practice / Prepare Views]
    end

    subgraph Gateway["API Gateway - Node.js / Express"]
        AUTH[JWT Auth Middleware]
        ROUTER[Route Handler]
        WS[WebSocket Server]
        SM[Sandbox Manager]
        REAPER[Auto-Reaper Service]
    end

    subgraph Sandbox["Sandbox Engine - Dual Mode"]
        PTY["PTY Mode\n(node-pty)"]
        DOCKER["Docker Mode\n(dockerode)"]
    end

    subgraph AIHub["AI Agent Hub - Python / Flask"]
        AG0[Agent 0: Anti-Abuse Scanner]
        AG1[Agent 1: Lab Assessor]
        AG2[Agent 2: Doc Retriever]
        AG3[Agent 3: AI Mentor]
        VDB[(Qdrant Vector DB)]
    end

    subgraph Storage["Data Layer"]
        MONGO[(MongoDB Atlas / JWT Store)]
        UNITS[(Learning Units JSON)]
    end

    Client -->|HTTPS + WSS| Gateway
    WS -->|stdin/stdout| SM
    SM -->|SANDBOX_MODE=pty| PTY
    SM -->|SANDBOX_MODE=docker| DOCKER
    ROUTER -->|REST API| AIHub
    AG2 --> VDB
    AUTH --> MONGO
    ROUTER --> UNITS
    REAPER -.->|Cleans Stale Sessions| SM

    style Client fill:#0d1117,stroke:#00d4ff,color:#e2e8f0
    style Gateway fill:#0d1117,stroke:#7c3aed,color:#e2e8f0
    style Sandbox fill:#0d1117,stroke:#10b981,color:#e2e8f0
    style AIHub fill:#0d1117,stroke:#f59e0b,color:#e2e8f0
    style Storage fill:#0d1117,stroke:#64748b,color:#e2e8f0
```

### Multi-Agent Pipeline (LangGraph)

```mermaid
graph LR
    INPUT[User Query + Terminal Context] --> AG0

    AG0{"Anti-Abuse\nScanner"}
    AG0 -->|Safe| AG1
    AG0 -->|Threat| BLOCK[Block and Reap Container]

    AG1{"Lab\nAssessor"}
    AG1 --> AG2

    AG2{"Doc\nRetriever"}
    AG2 -->|RAG from Qdrant| AG3

    AG3{"AI\nMentor"}
    AG3 --> OUTPUT[Contextual Hint Response]

    style AG0 fill:#ef4444,stroke:#ef4444,color:#fff
    style AG1 fill:#f59e0b,stroke:#f59e0b,color:#fff
    style AG2 fill:#3b82f6,stroke:#3b82f6,color:#fff
    style AG3 fill:#10b981,stroke:#10b981,color:#fff
    style BLOCK fill:#7f1d1d,stroke:#ef4444,color:#fff
```

### Deployment Architecture (Free Tier)

```mermaid
graph TB
    USER[Student Browser] -->|HTTPS| VERCEL

    subgraph Vercel["Vercel - Free"]
        VERCEL[React Static Build]
    end

    subgraph Render1["Render - Free"]
        API[Node.js API Gateway\n+ PTY Sandbox Engine]
    end

    subgraph Render2["Render - Free"]
        FLASK[Python Flask\nAI Agent Hub]
    end

    subgraph Cloud["Free Cloud Services"]
        ATLAS[(MongoDB Atlas\n512MB Free)]
        QDRANT[(Qdrant Cloud\n1GB Free)]
    end

    VERCEL -->|REST + WS| API
    API -->|HTTP| FLASK
    API --> ATLAS
    FLASK --> QDRANT

    style Vercel fill:#000,stroke:#00d4ff,color:#fff
    style Render1 fill:#0d1117,stroke:#7c3aed,color:#fff
    style Render2 fill:#0d1117,stroke:#f59e0b,color:#fff
    style Cloud fill:#0d1117,stroke:#64748b,color:#fff
```

---

## Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| **React 19** + **Vite** | SPA framework with HMR |
| **xterm.js** | Terminal emulator with WebSocket I/O |
| **React Router v7** | Client-side routing for 3-mode learning views |
| **Axios** | HTTP client with auth interceptors |
| **Lucide React** | Icon library |
| **CSS3** | Custom design system — glassmorphism, gradients, micro-animations, 3D card flips |

### Backend (API Gateway)
| Technology | Purpose |
|---|---|
| **Node.js** + **Express** | REST API server |
| **ws** | WebSocket server for terminal streaming |
| **node-pty** | PTY sandbox engine (local/cloud mode) |
| **dockerode** | Docker sandbox engine (production mode) |
| **JWT** + **bcryptjs** | Authentication and password hashing |

### AI Agent Hub
| Technology | Purpose |
|---|---|
| **Python** + **Flask** | AI microservice |
| **LangGraph** | Multi-agent orchestration framework |
| **Qdrant** | Vector database for RAG retrieval |
| **sentence-transformers** | Document embedding model |
| **scikit-learn** | Isolation Forest for anomaly detection |

### Infrastructure
| Technology | Purpose |
|---|---|
| **Docker** + **Docker Compose** | Local containerized development |
| **Kubernetes** | Production manifests (deployment, service, ingress) |
| **Vercel** | Frontend hosting (free) |
| **Render** | Backend hosting (free) |
| **MongoDB Atlas** | User data persistence (free 512MB) |
| **Qdrant Cloud** | Vector storage (free 1GB) |

---

## Quick Start

### Prerequisites

- **Node.js** >= 18 ([Download](https://nodejs.org))
- **npm** >= 9
- **Docker Desktop** (optional, for Docker sandbox mode)

### 1. Clone and Install

```bash
git clone https://github.com/yashsrivastava1408/OpsAcademy.git
cd OpsAcademy

# Install server dependencies
cd server && npm install

# Install client dependencies
cd ../client && npm install

# (Optional) Install Python AI Hub dependencies
cd ../ai-hub && pip install -r requirements.txt
```

### 2. Configure Environment

```bash
# Server environment
cp server/.env.example server/.env
# Edit server/.env and set JWT_SECRET to a secure random string
```

### 3. Run Development Servers

```bash
# Option A: Start individual microservices

# Terminal 1 - API Gateway
cd server && npm run dev
# Server running at http://localhost:4000 (PTY mode)

# Terminal 2 - React Client
cd client && npm run dev
# Client running at http://localhost:5173

# Terminal 3 (Optional) - Python AI Agent Hub
cd ai-hub && python app.py
# AI Hub running at http://localhost:5005

# Option B: Run entire stack via Docker Compose
docker-compose up --build
```

### 4. Open in Browser

Navigate to `http://localhost:5173` > Click **Start Learning** > Choose a Learning Unit > Choose Learn, Practice, or Prepare mode.

---

## Project Structure

```
opsacademy/
|-- client/                          # React frontend (Vite)
|   |-- src/
|   |   |-- components/
|   |   |   |-- Navbar/              # Navigation bar with mode status
|   |   |   |-- Terminal/            # xterm.js WebSocket terminal
|   |   |   |-- Quiz/                # Multiple-choice concept check component
|   |   |   |-- Flashcard/           # Interactive 3D flip card component
|   |   |   |-- MentorChat/          # AI Mentor chat component
|   |   |   +-- CertificateModal/    # Course completion certificate modal
|   |   |-- pages/
|   |   |   |-- LandingPage.jsx      # Hero + features + architecture
|   |   |   |-- DashboardPage.jsx    # Unit catalog with 3-mode buttons
|   |   |   |-- LearnPage.jsx        # Mode 1: Theory reader + quizzes
|   |   |   |-- LabPage.jsx          # Mode 2: Live terminal lab + verification
|   |   |   +-- PreparePage.jsx      # Mode 3: Flashcards + placement Q&A
|   |   |-- services/
|   |   |   +-- api.js               # Axios client + WS URL helper
|   |   |-- App.jsx                  # Router setup
|   |   +-- index.css                # Design system (CSS custom properties)
|   |-- Dockerfile                   # Client Docker container spec
|   |-- index.html                   # SEO-optimized HTML shell
|   +-- package.json
|
|-- server/                          # Node.js API Gateway
|   |-- config/
|   |   +-- index.js                 # Centralized config (env vars)
|   |-- data/
|   |   +-- units/                   # 14 Complete A-to-Z Learning Units
|   |       |-- linux-basics/        # Linux Fundamentals (8 sections)
|   |       |-- git-basics/          # Git & GitHub Workflow (7 sections)
|   |       |-- docker-basics/       # Docker Fundamentals (8 sections)
|   |       |-- kubernetes-basics/   # Kubernetes Orchestration (8 sections)
|   |       |-- networking-fundamentals/ # Networking (6 sections)
|   |       |-- cicd-pipelines/      # CI/CD Pipelines (6 sections)
|   |       |-- aws-cloud-essentials/ # Cloud Computing / AWS (6 sections)
|   |       |-- monitoring-observability/ # Monitoring & Observability (5 sections)
|   |       |-- terraform-iac/       # Terraform & Infrastructure as Code (4 sections)
|   |       |-- system-design-scalability/ # System Design & Scalability (4 sections)
|   |       |-- devsecops-security/  # DevSecOps & Cloud Security (2 sections)
|   |       |-- bash-automation/     # Advanced Bash Automation (2 sections)
|   |       |-- python-devops-automation/ # Python Cloud Automation (2 sections)
|   |       +-- gitops-argocd/       # GitOps & ArgoCD (2 sections)
|   |-- middleware/
|   |   |-- auth.js                  # JWT authorization middleware
|   |   +-- errorHandler.js          # Global JSON error handler
|   |-- routes/
|   |   |-- sandboxRoutes.js         # Sandbox lifecycle REST API
|   |   |-- unitRoutes.js            # Learning units & mode content API
|   |   |-- labRoutes.js             # Sandbox test verification API
|   |   |-- agentRoutes.js           # AI Agent Hub proxy API
|   |   +-- authRoutes.js            # Register, login, profile API
|   |-- services/
|   |   |-- ptyService.js            # PTY sandbox engine (node-pty)
|   |   |-- dockerService.js         # Docker sandbox engine (dockerode)
|   |   |-- sandboxManager.js        # Pluggable facade (mode switching)
|   |   |-- terminalService.js       # WebSocket terminal stream handler
|   |   +-- reaperService.js         # Auto-cleanup for stale sandboxes
|   |-- Dockerfile                   # Server Docker container spec
|   |-- server.js                    # Express + WS bootstrap
|   |-- .env.example                 # Environment template
|   +-- package.json
|
|-- ai-hub/                          # Python AI Agent Hub (Flask + LangGraph)
|   |-- agents/                      # Multi-Agent implementations
|   |   |-- abuse_scanner.py         # Isolation Forest & regex security scanner
|   |   |-- lab_assessor.py          # Lab state evaluation agent
|   |   |-- doc_retriever.py         # RAG retriever agent (Qdrant)
|   |   +-- mentor.py                # Context-aware AI mentoring agent
|   |-- app.py                       # Flask REST API server
|   |-- pipeline.py                  # LangGraph multi-agent orchestration workflow
|   |-- config.py                    # Environment configuration
|   |-- requirements.txt             # Python dependencies
|   +-- Dockerfile                   # AI Hub Docker container spec
|
|-- k8s/                             # Kubernetes manifests
|   |-- server.yaml                  # Gateway deployment & service
|   |-- ai-hub.yaml                  # AI Hub deployment & service
|   |-- configmap.yaml               # Shared cluster configuration
|   |-- ingress.yaml                 # Nginx Ingress routing
|   +-- namespace.yaml               # Isolated K8s namespace
|
|-- docker-compose.yml               # Multi-container local orchestration
|-- render.yaml                      # Render Blueprint IaC specification
|-- OpsAcademy_Master_Plan.md        # Technical design & roadmap document
|-- .gitignore
+-- README.md
```

---

## API Reference

### Sandbox Management

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/sandbox/start` | Create a new sandbox session |
| `DELETE` | `/api/sandbox/:sessionId` | Destroy a sandbox session |
| `GET` | `/api/sandbox/:sessionId/status` | Get sandbox info |
| `GET` | `/api/sandbox` | List all active sandboxes |
| `GET` | `/api/health` | Health check + sandbox mode |

### Learning Units & Labs

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/units` | List all learning units metadata |
| `GET` | `/api/units/:unitId` | Get metadata for a specific unit |
| `GET` | `/api/units/:unitId/:mode` | Get content for mode (`learn`, `practice`, `prepare`) |
| `POST` | `/api/labs/:unitId/verify` | Run verification checks inside active sandbox |

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register a new user |
| `POST` | `/api/auth/login` | Authenticate user and receive JWT |
| `GET` | `/api/auth/me` | Fetch authenticated user profile |

### AI Hub & Agent Mentoring

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/agent/hint` | Request contextual AI mentor hint (or gateway fallback) |
| `POST` | `/api/agent/scan` | Analyze command against security & anti-abuse pipeline |

### WebSocket

| Endpoint | Protocol | Description |
|---|---|---|
| `/api/terminal?sessionId=<id>` | `ws://` | Interactive terminal stream |

**WebSocket Messages:**

```
Browser -> Server:  raw keystrokes (UTF-8 text)
Browser -> Server:  {"type":"resize","cols":120,"rows":30}  (JSON control)
Server -> Browser:  terminal stdout output (UTF-8 text)
```

---

## Security Model

### Sandbox Isolation

| Layer | Protection |
|---|---|
| **Memory** | cgroup hard limit: 256MB per container |
| **CPU** | cgroup limit: 0.5 cores per container |
| **Filesystem** | Read-only rootfs; writable only `/home/student` and `/tmp` |
| **Network** | Isolated bridge network — no external internet by default |
| **Privileges** | `no-new-privileges` security option |
| **Lifecycle** | Auto-reaper kills containers after 30 minutes |

### Application Security

| Concern | Mitigation |
|---|---|
| **Secrets** | All secrets via environment variables; `.env` excluded from git |
| **Auth** | JWT tokens with configurable expiry; bcrypt password hashing |
| **CORS** | Restricted to configured `CLIENT_URL` origin |
| **Input** | AI Anti-Abuse agent scans all commands before execution |
| **Dependencies** | Regular `npm audit` scanning |

---

## Dual-Mode Sandbox Engine

OpsAcademy features a **pluggable sandbox architecture** — a single environment variable switches the entire backend:

```
SANDBOX_MODE=pty      # Local shell via node-pty (development + Render)
SANDBOX_MODE=docker   # Docker containers via dockerode (VPS production)
```

```mermaid
graph LR
    SM[Sandbox Manager\nFacade] -->|"SANDBOX_MODE=pty"| PTY["PTY Service\nnode-pty -> /bin/sh"]
    SM -->|"SANDBOX_MODE=docker"| DOCK["Docker Service\ndockerode -> Alpine"]

    PTY --> SAME[Same WebSocket\nTerminal Interface]
    DOCK --> SAME

    style SM fill:#7c3aed,stroke:#7c3aed,color:#fff
    style PTY fill:#10b981,stroke:#10b981,color:#fff
    style DOCK fill:#3b82f6,stroke:#3b82f6,color:#fff
    style SAME fill:#f59e0b,stroke:#f59e0b,color:#fff
```

**Why?** Cloud platforms like Render don't provide Docker socket access. PTY mode enables free-tier deployment while Docker mode provides full production isolation on a VPS.

---


## Engineering Highlights

| Metric / Pattern | Detail |
|---|---|
| **Terminal Latency** | <50ms keystroke-to-render via WebSocket binary frames |
| **Sandbox Isolation** | cgroup memory caps + read-only rootfs + network sub-bridging |
| **Pluggable Architecture** | Strategy pattern — swap sandbox engines via env var |
| **3-Mode Learning Engine** | Structured Learn theory, Practice terminal lab, Prepare interview Q&A |
| **Multi-Agent AI** | LangGraph pipeline: Abuse Scanner > Lab Assessor > Doc Retriever > Mentor |
| **RAG Pipeline** | Sentence-transformer embeddings > Qdrant similarity search > LLM synthesis |
| **Anomaly Detection** | Isolation Forest on command telemetry for unsupervised abuse detection |
| **Cost Optimization** | Auto-reaper cron reduces cloud hosting overhead by ~90% |
| **Production-Ready** | Docker Compose + Kubernetes manifests + Render Blueprint IaC |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built for DevOps learners. Powered by AI.**

[Back to top](#opsacademy)

</div>
