# OpsAcademy: Interactive DevOps & Cloud Engineering Learning Platform

An interactive, browser-based learning ecosystem designed to bridge the gap between theoretical knowledge and real-world DevOps execution. OpsAcademy integrates hands-on web terminal sandboxes, multi-agent AI mentoring, and placement-focused interview preparation.

---

## Table of Contents
- [Executive Overview](#executive-overview)
- [Screenshots & Demo](#screenshots--demo)
- [System Architecture](#system-architecture)
- [Multi-Agent AI Mentoring & Terminal Sequence](#multi-agent-ai-mentoring--terminal-sequence)
- [Student Learning Journey](#student-learning-journey)
- [Quantified Engineering Metrics](#quantified-engineering-metrics)
- [Production Course Catalog](#production-course-catalog)
- [Technology Stack](#technology-stack)
- [Local Installation & Development](#local-installation--development)
- [License & Authorship](#license--authorship)

---

## Executive Overview

OpsAcademy eliminates passive video consumption by enforcing a three-mode hands-on execution methodology:

1. **Learn Mode**: Concept breakdown featuring architecture diagrams, system analogies, and interactive vector visualizations.
2. **Practice Mode**: Step-by-step terminal execution in an isolated sandbox with real-time verification guidelines and contextual AI assistance.
3. **Prepare Mode**: Flashcard decks, recruiter evaluation rubrics, and model answer keys tailored for Cloud and DevOps placement interviews.

---

## Screenshots & Demo

| **Platform Dashboard** |
| <img width="1710" height="981" alt="Screenshot 2026-08-11 at 2 56 32 AM" src="https://github.com/user-attachments/assets/80c0f1a8-cdc2-4196-8b42-5e093dd64225" /><img width="1710" height="976" alt="Screenshot 2026-08-11 at 2 56 43 AM" src="https://github.com/user-attachments/assets/15d5d276-3435-4250-a21a-5ba4905c0a66" /> 
---

## System Architecture

OpsAcademy is built using a decoupled microservices architecture comprising a React frontend, a Node.js API Gateway managing pre-warmed sandbox pools (PTY & Docker container engines via WebSockets), a Python Multi-Agent AI Hub, and persistent database layers.

```mermaid
graph TB
    subgraph Client["Client Layer"]
        UI["React 19 SPA"]
        TERM["xterm.js Web Terminal"]
    end

    subgraph Gateway["API Gateway Layer"]
        EXPRESS["Express.js Server"]
        POOL["Pre-Warmed Sandbox Pool Service"]
        PTY["node-pty / Dockerode Engine"]
        SWEEPER["Activity & Inactivity Auto-Reaper"]
        JWT["JWT Auth & Rate Limiter"]
    end

    subgraph AIHub["Intelligence Layer (6-Agent Pipeline)"]
        FLASK["Python Flask Microservice"]
        AGENT0["Agent 0: Anti-Abuse De-obfuscator & ML"]
        AGENT1["Agent 1: Error Context Assessor"]
        AGENT15["Agent 1.5: Container Live Inspector"]
        AGENT2["Agent 2: TF-IDF Vector RAG Retriever"]
        AGENT3["Agent 3: Tiered 3-Level Socratic Mentor"]
        AGENT4["Agent 4: Automated Lab Objective Grader"]
    end

    subgraph Data["Persistence Layer"]
        MONGO[("MongoDB Atlas (User & Course State)")]
        QDRANT[("Qdrant Cloud (Vector RAG Index)")]
    end

    Client -->|HTTPS / WSS| Gateway
    Gateway -->|REST API| AIHub
    Gateway -->|Mongoose ORM| MONGO
    AIHub -->|Vector Search| QDRANT
    Gateway -->|Acquire Instant Sandbox <50ms| POOL
    POOL -->|Spawn / Attach| PTY
    SWEEPER -->|Reap Inactive Sandboxes >15m| PTY

    style Client fill:#0f172a,stroke:#0284c7,color:#f8fafc
    style Gateway fill:#0f172a,stroke:#6366f1,color:#f8fafc
    style AIHub fill:#0f172a,stroke:#d97706,color:#f8fafc
    style Data fill:#0f172a,stroke:#059669,color:#f8fafc
```

---

## Multi-Agent AI Mentoring & Terminal Sequence

The sequence diagram below illustrates the end-to-end execution flow when a student interacts with the web terminal and requests AI assistance.

```mermaid
sequenceDiagram
    autonumber
    actor Student as Student
    participant Web as React Web Client
    participant API as Node.js Gateway
    participant PTY as node-pty Sandbox
    participant AI as Python AI Hub (LangGraph)
    participant Qdrant as Qdrant Vector DB

    Student->>Web: Input Terminal Command
    Web->>API: Send WebSocket frame (WSS)
    API->>PTY: Write to pseudo-terminal stream
    PTY-->>API: Stream stdout / stderr
    API-->>Web: Stream output to xterm.js (<50ms)

    opt Student Requests AI Assistance
        Student->>Web: Click "Ask AI Mentor"
        Web->>API: POST /api/ai/hint (Context + Error Log)
        API->>AI: POST /api/intelligence/query
        AI->>Qdrant: Semantic similarity search (Documentation & Solution)
        Qdrant-->>AI: Return top-k relevant embeddings
        AI->>AI: LangGraph evaluates error context & generates hint
        AI-->>API: Return contextual guidance
        API-->>Web: Display AI Hint in UI Panel
    end
```

---

## Student Learning Journey

```mermaid
flowchart TD
    Start["Student Accesses OpsAcademy"] --> Auth["Authenticate via JWT / OAuth"]
    Auth --> SelectCourse["Select Course Path (e.g., Docker Orchestration)"]
    
    SelectCourse --> Mode1["Learn Mode: Read Theory & View Architecture Diagrams"]
    Mode1 --> Quiz["Pass Concept Check Quiz"]
    
    Quiz --> Mode2["Practice Mode: Spawn Interactive Sandbox Terminal"]
    Mode2 --> TerminalExec["Execute Hands-on Commands in xterm.js"]
    TerminalExec --> AIHelp{"Need Assistance?"}
    AIHelp -- Yes --> AskAI["AI Mentor RAG Pipeline Provides Contextual Hint"]
    AskAI --> TerminalExec
    AIHelp -- No --> VerifyCmd["Automated Command Verification Passed"]
    
    VerifyCmd --> Mode3["Prepare Mode: Placement Interview Flashcards"]
    Mode3 --> TrackProgress["Update MongoDB Progress Metrics"]
    TrackProgress --> Complete["Placement Ready"]

    style Start fill:#0f172a,stroke:#0284c7,color:#f8fafc
    style Mode1 fill:#0f172a,stroke:#6366f1,color:#f8fafc
    style Mode2 fill:#0f172a,stroke:#d97706,color:#f8fafc
    style Mode3 fill:#0f172a,stroke:#059669,color:#f8fafc
    style Complete fill:#0f172a,stroke:#10b981,color:#f8fafc
```

---

## Quantified Engineering Metrics

| Metric | Target / Benchmark | Implementation Detail |
| :--- | :--- | :--- |
| **Terminal Latency** | **<50ms** | Binary WebSocket streaming via `xterm.js` and `node-pty` / `dockerode`. |
| **Sandbox Boot Latency** | **<50ms Instant Claim** | Pre-warmed standby pool (`sandboxPoolService.js`) eliminates 3s cold container boot. |
| **Idle Resource Efficiency** | **~90% RAM Savings** | Background Auto-Reaper service reaps inactive sandboxes (>15m idle / 30m max runtime). |
| **Security Payload Inspection** | **De-obfuscated ML** | Base64/Hex payload de-anonymization + Isolation Forest ML threat detection. |
| **Socratic AI Guidance** | **3-Tier Hints** | Progressive hint structure (Tier 1 Nudge -> Tier 2 Diagnostic -> Tier 3 Syntax). |
| **Concurrency Telemetry** | **Real-Time Monitoring** | Live execution metrics and standby pool buffer status on `/api/sandbox/metrics`. |
| **Curriculum Coverage** | **14 Paths** | Structured progression covering Linux, Kubernetes, Terraform, and GitOps. |
| **AI Retrieval Latency** | **<400ms** | TF-IDF vector similarity search combined with 6-agent RAG routing. |

---

## Production Course Catalog

1. **Linux Fundamentals**: Kernel concepts, process management, file permissions, and shell navigation.
2. **Git & GitHub Workflow**: Branching strategies, interactive rebasing, merge conflict resolution, and PR workflows.
3. **Docker Containers**: Containerization mechanics, image optimization, multi-stage builds, and compose networking.
4. **Kubernetes Orchestration**: Pods, Deployments, Services, Ingress Controllers, ConfigMaps, and Secrets.
5. **Networking Fundamentals**: TCP/IP stack, DNS resolution, HTTP/S protocols, CIDR subnetting, and firewalls.
6. **CI/CD Pipelines**: Automated workflows using GitHub Actions, artifact management, and release tagging.
7. **AWS Cloud Essentials**: EC2, S3, IAM policies, VPC networking, and Security Groups.
8. **Monitoring & Observability**: Prometheus metrics collection, Grafana dashboard visualization, and Alertmanager.
9. **Terraform Infrastructure as Code**: Declarative provisioning, HCL syntax, state management, and module design.
10. **System Design & High Availability**: Load balancing, auto-scaling, disaster recovery, and fault tolerance.
11. **DevSecOps & Security**: Container vulnerability scanning, OWASP API security, and SBOM generation.
12. **Advanced Bash Scripting**: Automation scripts, error trapping, parsing CLI flags, and cron jobs.
13. **Python Cloud Automation**: Scripting AWS infrastructure management using `boto3` and REST SDKs.
14. **GitOps & ArgoCD**: Declarative continuous delivery, cluster state synchronization, and automated rollbacks.

---

## Technology Stack

- **Frontend**: React 19, Vite, xterm.js, Vanilla CSS Glassmorphism
- **API Gateway**: Node.js, Express, `sandboxPoolService`, `node-pty` / `dockerode`, WebSockets, JWT Auth, Mongoose ORM
- **Intelligence Layer**: Python, Flask, 6-Agent Cooperative RAG Pipeline, Isolation Forest ML, Base64 De-obfuscator, TF-IDF Vector Engine
- **Database Systems**: MongoDB Atlas (User State & Course Progress), Qdrant Cloud (Vector RAG Index)

---

## Local Installation & Development

### 1. Repository Clone
```bash
git clone https://github.com/yashsrivastava1408/OpsAcademy.git
cd OpsAcademy
```

### 2. Client Setup
```bash
cd client
npm install
npm run dev
```

### 3. API Gateway Setup
```bash
cd ../server
npm install
npm start
```

Access the client interface locally at `http://localhost:5173`.

---

## License & Authorship

- **Author**: Yash Srivastava
- **Live Platform**: [https://ops-academy-chi.vercel.app](https://ops-academy-chi.vercel.app)
- **License**: MIT
