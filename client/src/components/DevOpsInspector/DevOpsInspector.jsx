import { useState, useEffect, useRef } from 'react';
import {
  Folder,
  FileText,
  Activity,
  History,
  Play,
  HelpCircle,
  RefreshCw,
  Cpu,
  Radio,
  Eye,
  CheckCircle2,
  GripHorizontal,
  Minus,
  Maximize2,
  X,
} from 'lucide-react';
import { sandboxApi } from '../../services/api';
import './DevOpsInspector.css';

const RECRUITER_QUICK_TIPS = {
  'docker-containers': {
    question: 'Q: What is the difference between docker run and docker exec?',
    answer: '`docker run` creates and starts a NEW container from an image. `docker exec` runs a new command/shell inside an ALREADY RUNNING container.',
  },
  'linux-fundamentals': {
    question: 'Q: How do you check file permissions and active listening ports in Linux?',
    answer: 'Use `ls -la` to view Owner/Group/Other permission bits (e.g. 755 = rwxr-xr-x). Use `netstat -tuln` or `ss -tuln` to check listening TCP/UDP ports.',
  },
  'kubernetes-orchestration': {
    question: 'Q: How do you debug a Pod stuck in CrashLoopBackOff status?',
    answer: '1. `kubectl get pods` to verify state. 2. `kubectl describe pod <name>` to read event warnings. 3. `kubectl logs <name>` to inspect container crash logs.',
  },
  default: {
    question: 'Q: How do recruiters evaluate hands-on DevOps terminal skills?',
    answer: 'Recruiters check your ability to check process status (`ps aux`), verify listening sockets (`netstat`), inspect logs (`tail -f`), and write clean scripts.',
  },
};

export default function DevOpsInspector({
  sessionId,
  unitId = 'default',
  commandHistory = [],
  onRunCommand,
  onClose,
}) {
  const [activeTab, setActiveTab] = useState('files'); // files | sys | cmds
  const [showAnswer, setShowAnswer] = useState(false);
  const [telemetry, setTelemetry] = useState({ fileTree: [], processes: [], ports: [] });
  const [loading, setLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [isMinimized, setIsMinimized] = useState(false);

  // Draggable State
  const [pos, setPos] = useState({ x: window.innerWidth - 370, y: 90 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const tipData = RECRUITER_QUICK_TIPS[unitId] || RECRUITER_QUICK_TIPS.default;
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const fetchTelemetry = async () => {
    if (!sessionId || sessionId.startsWith('local-lab-')) return;
    try {
      setLoading(true);
      const res = await sandboxApi.getTelemetry(sessionId);
      if (isMounted.current && res.data?.data) {
        setTelemetry(res.data.data);
      }
    } catch (err) {
      if (err.response?.status === 404) {
        // Session expired or killed on server; quiet reset
        if (isMounted.current) {
          setTelemetry({ fileTree: [], processes: [], ports: [] });
        }
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!sessionId || sessionId.startsWith('local-lab-')) {
      setTelemetry({ fileTree: [], processes: [], ports: [] });
      return;
    }
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);

  // Drag listeners
  const handleMouseDown = (e) => {
    isDragging.current = true;
    dragStart.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (!isDragging.current) return;
    const newX = Math.max(10, Math.min(window.innerWidth - 350, e.clientX - dragStart.current.x));
    const newY = Math.max(10, Math.min(window.innerHeight - 100, e.clientY - dragStart.current.y));
    setPos({ x: newX, y: newY });
  };

  const handleMouseUp = () => {
    isDragging.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  if (isMinimized) {
    return (
      <div
        className="inspector-minimized-pill glass-card animate-scale-in"
        style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
        onClick={() => setIsMinimized(false)}
      >
        <Activity size={14} className="pulse-icon" />
        <span>DevOps Inspector</span>
        <button className="pill-expand-btn" title="Expand Card">
          <Maximize2 size={12} />
        </button>
      </div>
    );
  }

  return (
    <aside
      className="devops-inspector floating-inspector glass-card animate-scale-in"
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
    >
      {/* ── Draggable Title Drag Handle ───────────────────────── */}
      <div className="inspector-drag-handle" onMouseDown={handleMouseDown}>
        <GripHorizontal size={14} className="drag-grip" />
        <span className="drag-label">DevOps System Inspector</span>
        <div className="drag-controls">
          <button
            className="btn btn-ghost btn-xs ctrl-btn"
            onClick={() => setIsMinimized(true)}
            title="Minimize Card"
          >
            <Minus size={13} />
          </button>
          {onClose && (
            <button
              className="btn btn-ghost btn-xs ctrl-btn"
              onClick={onClose}
              title="Close Inspector"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── Recruiter Placement Quick-Tip Banner ───────────────── */}
      <div className="inspector-tip-card">
        <div className="tip-header" onClick={() => setShowAnswer(!showAnswer)}>
          <div className="tip-title">
            <HelpCircle size={13} className="tip-icon" />
            <span>Placement Interview Quick-Tip</span>
          </div>
          <button className="btn btn-ghost btn-xs tip-toggle-btn">
            {showAnswer ? 'Hide' : 'Answer'}
          </button>
        </div>
        <p className="tip-question">{tipData.question}</p>
        {showAnswer && (
          <div className="tip-answer animate-fade-in">
            <CheckCircle2 size={12} className="answer-check" />
            <span>{tipData.answer}</span>
          </div>
        )}
      </div>

      {/* ── Tabs Header ────────────────────────────────────────── */}
      <div className="inspector-tabs">
        <button
          className={`tab-btn ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          <Folder size={13} />
          <span>Files</span>
          {telemetry.fileTree.length > 0 && (
            <span className="count-pill">{telemetry.fileTree.length}</span>
          )}
        </button>
        <button
          className={`tab-btn ${activeTab === 'sys' ? 'active' : ''}`}
          onClick={() => setActiveTab('sys')}
        >
          <Activity size={13} />
          <span>Sys / Ports</span>
          {telemetry.ports.length > 0 && (
            <span className="count-pill green">{telemetry.ports.length}</span>
          )}
        </button>
        <button
          className={`tab-btn ${activeTab === 'cmds' ? 'active' : ''}`}
          onClick={() => setActiveTab('cmds')}
        >
          <History size={13} />
          <span>Cmds</span>
          {commandHistory.length > 0 && (
            <span className="count-pill">{commandHistory.length}</span>
          )}
        </button>

        <button className="refresh-btn" onClick={fetchTelemetry} title="Refresh System Telemetry">
          <RefreshCw size={12} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {/* ── Tab Contents ───────────────────────────────────────── */}
      <div className="inspector-body">
        {/* TAB 1: Live Container File Tree */}
        {activeTab === 'files' && (
          <div className="tab-content animate-fade-in">
            <div className="tree-header">
              <span className="tree-root-label">📁 /home/student</span>
            </div>

            {telemetry.fileTree.length === 0 ? (
              <div className="empty-inspector">
                <Folder size={22} />
                <p>No files created yet.</p>
                <span className="hint-text">Run <code>mkdir app</code> or <code>touch index.html</code> in shell</span>
              </div>
            ) : (
              <div className="file-tree-list">
                {telemetry.fileTree.map((item, i) => (
                  <div
                    key={i}
                    className={`tree-item depth-${Math.min(item.depth, 3)}`}
                  >
                    {item.type === 'directory' ? (
                      <Folder size={13} className="folder-icon" />
                    ) : (
                      <FileText size={13} className="file-icon" />
                    )}
                    <span className="item-name">{item.name}</span>
                    {item.type === 'file' && (
                      <button
                        className="btn btn-ghost btn-xs inspect-file-btn"
                        onClick={() => setPreviewFile(item)}
                        title="Preview File"
                      >
                        <Eye size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Running Processes & Listening Ports */}
        {activeTab === 'sys' && (
          <div className="tab-content animate-fade-in">
            <div className="section-block">
              <div className="block-title">
                <Radio size={12} />
                <span>Listening Network Ports</span>
              </div>
              {telemetry.ports.length === 0 ? (
                <span className="none-text">No active listening ports detected</span>
              ) : (
                <div className="ports-flex">
                  {telemetry.ports.map((port, i) => (
                    <span key={i} className="port-badge">
                      🟢 Port {port}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="section-block mt-3">
              <div className="block-title">
                <Cpu size={12} />
                <span>Running Processes (ps aux)</span>
              </div>
              {telemetry.processes.length === 0 ? (
                <span className="none-text">Container initializing...</span>
              ) : (
                <div className="processes-list">
                  {telemetry.processes.map((proc, i) => (
                    <div key={i} className="process-card">
                      <div className="proc-header">
                        <span className="proc-pid">PID {proc.pid}</span>
                        <span className="proc-user">{proc.user}</span>
                      </div>
                      <code className="proc-cmd">{proc.command}</code>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: Recent Command History */}
        {activeTab === 'cmds' && (
          <div className="tab-content animate-fade-in">
            {commandHistory.length === 0 ? (
              <div className="empty-inspector">
                <History size={22} />
                <p>No recent commands.</p>
                <span className="hint-text">Type commands in the shell to populate history</span>
              </div>
            ) : (
              <div className="history-list">
                {commandHistory.slice(-10).reverse().map((cmd, i) => (
                  <div key={i} className="history-item">
                    <code className="history-cmd">{cmd}</code>
                    {onRunCommand && (
                      <button
                        className="btn btn-ghost btn-xs run-cmd-btn"
                        onClick={() => onRunCommand(cmd)}
                        title="Re-run command in shell"
                      >
                        <Play size={11} /> Run
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── File Content Preview Modal ───────────────────────── */}
      {previewFile && (
        <div className="file-preview-overlay" onClick={() => setPreviewFile(null)}>
          <div className="file-preview-card glass-card" onClick={(e) => e.stopPropagation()}>
            <div className="preview-header">
              <span>📄 {previewFile.path}</span>
              <button className="btn btn-ghost btn-xs" onClick={() => setPreviewFile(null)}>✖</button>
            </div>
            <div className="preview-body">
              <code>File preview active: /home/student/{previewFile.path}</code>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
