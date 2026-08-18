import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Wifi, WifiOff, Loader, Play } from 'lucide-react';
import { getTerminalWsUrl } from '../../services/api';
import './Terminal.css';

export default function Terminal({ sessionId, onDisconnect, onStartLab }) {
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const [status, setStatus] = useState('disconnected'); // disconnected | connecting | connected

  const connectWebSocket = useCallback(() => {
    if (!sessionId) return;

    setStatus('connecting');
    const wsUrl = getTerminalWsUrl(sessionId);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    if (xtermRef.current) {
      xtermRef.current.clear();
      xtermRef.current.writeln('\x1b[1;36m[OpsAcademy Sandbox Gateway]\x1b[0m');
      xtermRef.current.writeln('\x1b[90mConnecting to live container sandbox...\x1b[0m');
    }

    ws.onopen = () => {
      setStatus('connected');
      if (xtermRef.current) {
        xtermRef.current.clear();
      }
      if (fitAddonRef.current) {
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      }
    };

    ws.onmessage = (event) => {
      if (xtermRef.current) {
        xtermRef.current.write(event.data);
      }
    };

    ws.onerror = (err) => {
      console.error('[Terminal WS Error]', err);
      setStatus('disconnected');
    };

    ws.onclose = () => {
      setStatus('disconnected');
      if (onDisconnect) onDisconnect();
    };
  }, [sessionId, onDisconnect]);

  // Initialize xterm.js
  useEffect(() => {
    if (!termRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selectionBackground: 'rgba(56, 139, 253, 0.3)',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39d353',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d364',
        brightWhite: '#f0f6fc',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 14,
      lineHeight: 1.35,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(termRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Send keystrokes to WebSocket
    term.onData((data) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(data);
      }
    });

    // Handle window resize
    const handleResize = () => {
      fitAddon.fit();
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      }
    };

    window.addEventListener('resize', handleResize);

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => fitAddon.fit());
    });
    observer.observe(termRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      term.dispose();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Connect when sessionId is available
  useEffect(() => {
    if (sessionId) {
      connectWebSocket();
    } else {
      setStatus('disconnected');
    }

    return () => {
      if (wsRef.current) {
        const ws = wsRef.current;
        ws.onopen = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.onmessage = null;
        if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
          try { ws.close(); } catch { /* ignore */ }
        }
        wsRef.current = null;
      }
    };
  }, [sessionId, connectWebSocket]);

  const statusIcon = {
    connected: <Wifi size={12} />,
    connecting: <Loader size={12} className="spin" />,
    disconnected: <WifiOff size={12} />,
  };

  return (
    <div className="terminal-container">
      {/* macOS-style header bar */}
      <div className="terminal-header">
        <div className="terminal-header-left">
          <div className="terminal-dots">
            <span className="terminal-dot red"></span>
            <span className="terminal-dot yellow"></span>
            <span className="terminal-dot green"></span>
          </div>
          <div className="terminal-title">
            student@opsacademy ~ /home/student
          </div>
        </div>
        <div className="terminal-header-right">
          <div className={`terminal-status ${status}`}>
            {statusIcon[status]}
            {status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting...' : 'Offline'}
          </div>
        </div>
      </div>

      {/* Terminal body */}
      <div
        className="terminal-body"
        onClick={() => xtermRef.current && xtermRef.current.focus()}
      >
        <div ref={termRef} style={{ height: '100%', width: '100%' }} />
        {!sessionId && (
          <div className="terminal-loading">
            {onStartLab ? (
              <button className="btn btn-primary btn-md" onClick={onStartLab}>
                <Play size={16} /> Click "Start Lab" to Initialize Live Shell
              </button>
            ) : (
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>
                ⚡ Click "Start Lab" above to connect to live interactive sandbox
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
