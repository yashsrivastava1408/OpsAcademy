import { useState, useEffect, useRef, useCallback } from 'react';
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
import usePolling from '../../hooks/usePolling';
import './DevOpsInspector.css';

const TELEMETRY_POLL_MS = 5000;
const EMPTY_TELEMETRY = { fileTree: [], processes: [], ports: [] };

const RECRUITER_QUICK_TIPS = {
  'docker-basics': {
    question: 'Q: What is the difference between docker run and docker exec?',
    answer: '`docker run` creates and starts a NEW container from an image. `docker exec` runs a new command/shell inside an ALREADY RUNNING container.',
  },
  'linux-basics': {
    question: 'Q: How do you check file permissions and active listening ports in Linux?',
    answer: 'Use `ls -la` to view Owner/Group/Other permission bits (e.g. 755 = rwxr-xr-x). Use `netstat -tuln` or `ss -tuln` to check listening TCP/UDP ports.',
  },
  'kubernetes-basics': {
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
  const [telemetry, setTelemetry] = useState(EMPTY_TELEMETRY);
  const [loading, setLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [preview, setPreview] = useState({ loading: false, content: '', truncated: false, error: null });

  const openPreview = async (item) => {
    setPreviewFile(item);
    setPreview({ loading: true, content: '', truncated: false, error: null });
    try {
      const res = await sandboxApi.getFile(sessionId, item.path);
      setPreview({ loading: false, content: res.data.data.content, truncated: res.data.data.truncated, error: null });
    } catch (err) {
      setPreview({ loading: false, content: '', truncated: false, error: err.response?.data?.error || 'Could not read this file' });
    }
  };
  const [isMinimized, setIsMinimized] = useState(false);

  // Draggable State
  // Starts below the lab header and its warning banners, so it covers none of their buttons.
  const [pos, setPos] = useState(() => ({ x: Math.max(10, window.innerWidth - 370), y: 200 }));

  const tipData = RECRUITER_QUICK_TIPS[unitId] || RECRUITER_QUICK_TIPS.default;

  // Each request remembers which session it was for, so a slow answer for a
  // sandbox that has since been stopped or replaced is thrown away.
  const sessionRef = useRef(sessionId);
  useEffect(() => {
    sessionRef.current = sessionId;
    if (!sessionId) setTelemetry(EMPTY_TELEMETRY);
    return () => { sessionRef.current = null; };
  }, [sessionId]);

  const fetchTelemetry = useCallback(async () => {
    if (!sessionId) return;
    const current = () => sessionRef.current === sessionId;
    setLoading(true);
    try {
      const res = await sandboxApi.getTelemetry(sessionId);
      if (current() && res.data?.data) setTelemetry(res.data.data);
    } catch (err) {
      // Session expired or killed on the server; quiet reset
      if (current() && err.response?.status === 404) setTelemetry(EMPTY_TELEMETRY);
    } finally {
      if (current()) setLoading(false);
    }
  }, [sessionId]);

  // Each poll runs commands inside the sandbox, so it only happens while the
  // panel is open and the tab is visible.
  usePolling(fetchTelemetry, TELEMETRY_POLL_MS, Boolean(sessionId) && !isMinimized);

  // Dragging: the listeners live on the document while the mouse is down.
  const stopDrag = useRef(null);
  useEffect(() => () => { if (stopDrag.current) stopDrag.current(); }, []);

  const handleMouseDown = (e) => {
    if (e.target.closest('button')) return;
    const offset = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const onMove = (event) => {
      setPos({
        x: Math.max(10, Math.min(window.innerWidth - 350, event.clientX - offset.x)),
        y: Math.max(10, Math.min(window.innerHeight - 100, event.clientY - offset.y)),
      });
    };
    const stop = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', stop);
      stopDrag.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', stop);
    stopDrag.current = stop;
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
                {telemetry.fileTree.map((item) => (
                  <div
                    key={item.path}
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
                        onClick={() => openPreview(item)}
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
                <span>Running Processes</span>
              </div>
              {telemetry.processes.length === 0 ? (
                <span className="none-text">{sessionId ? 'No processes listed' : 'Start the lab to see processes'}</span>
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
                {commandHistory.slice(-25).reverse().map((cmd, i) => (
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
              {preview.loading && <span className="none-text">Reading file...</span>}
              {preview.error && <span className="none-text">{preview.error}</span>}
              {!preview.loading && !preview.error && (
                <pre className="preview-content">{preview.content || '(empty file)'}</pre>
              )}
              {preview.truncated && <span className="none-text">Showing the first 20 KB.</span>}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
