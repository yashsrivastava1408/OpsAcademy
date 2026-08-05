import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Wifi, WifiOff, Loader } from 'lucide-react';
import './Terminal.css';

export default function Terminal({ sessionId, _onDisconnect }) {
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const [status, setStatus] = useState('disconnected'); // disconnected | connecting | connected

  const connectWebSocket = useCallback(() => {
    // Terminal usage blocked by maintenance mode
    setStatus('disconnected');
    if (xtermRef.current) {
      xtermRef.current.clear();
      xtermRef.current.writeln('\x1b[1;33m[OpsAcademy System Notice]\x1b[0m');
      xtermRef.current.writeln('--------------------------------------------------');
      xtermRef.current.writeln('\x1b[1;31mTerminal Execution Locked for Live Cloud Maintenance.\x1b[0m');
      xtermRef.current.writeln('All theory modules, practice task instructions, hints,');
      xtermRef.current.writeln('and interview Q&A decks remain 100% active!');
      xtermRef.current.writeln('--------------------------------------------------');
    }
  }, []);

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

    // ResizeObserver for container changes
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
    }

    return () => {
      if (wsRef.current) {
        const ws = wsRef.current;
        ws.onopen = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.onmessage = null;
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => {
            try { ws.close(); } catch { /* ignore */ }
          };
        } else if (ws.readyState === WebSocket.OPEN) {
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
            <span style={{ color: '#f59e0b', fontWeight: 600 }}>🔒 Terminal Usage Blocked (Live Cloud Maintenance)</span>
          </div>
        )}
      </div>
    </div>
  );
}
