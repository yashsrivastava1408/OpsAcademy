import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Wifi, WifiOff, Loader, Play } from 'lucide-react';
import { getTerminalWsUrl, sandboxApi } from '../../services/api';
import { createTypeahead } from './typeahead';
import './Terminal.css';

// Close codes after which the sandbox itself is gone, so there is nothing to
// reconnect to: 4000 session ended (stopped, idle, max age, abuse),
// 4029 input flood, 1001 the gateway is shutting down.
const SESSION_OVER_CODES = new Set([4000, 4029, 1001]);
const MAX_RECONNECT_ATTEMPTS = 6;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

const Terminal = forwardRef(function Terminal({ sessionId, onDisconnect, onStartLab }, ref) {
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const typeaheadRef = useRef(null);
  const [status, setStatus] = useState('disconnected'); // disconnected | connecting | connected

  // Kept in a ref so a new callback from the parent does not reconnect the socket.
  const onDisconnectRef = useRef(onDisconnect);
  useEffect(() => {
    onDisconnectRef.current = onDisconnect;
  }, [onDisconnect]);

  // Lets the lab page type into the shell, e.g. to re-run a command from history.
  useImperativeHandle(ref, () => ({
    send(text) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(text);
        if (xtermRef.current) xtermRef.current.focus();
      }
    },
  }), []);

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
    // Lets browser tests read the screen, whichever renderer draws it.
    termRef.current.__xterm = term;

    // Writes still being processed by xterm; local echo waits for a settled screen.
    let writesInFlight = 0;
    const write = (text) => {
      if (!text) return;
      writesInFlight += 1;
      term.write(text, () => { writesInFlight -= 1; });
    };

    // On a slow connection, typed characters are shown before the sandbox echoes them.
    const typeahead = createTypeahead({
      write,
      getState: () => {
        const buffer = term.buffer.active;
        const line = buffer.getLine(buffer.baseY + buffer.cursorY);
        return {
          cols: term.cols,
          cursorX: buffer.cursorX,
          lineLength: line ? line.translateToString(true).length : 0,
          alternate: buffer.type === 'alternate',
          busy: writesInFlight > 0,
        };
      },
    });
    typeaheadRef.current = { typeahead, write };
    termRef.current.__typeahead = typeahead;

    // Send keystrokes to WebSocket
    term.onData((data) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        typeahead.input(data);
        wsRef.current.send(data);
      }
    });

    // Tell the shell whenever the grid changes size, whatever caused it: the
    // window, or a side panel opening next to the terminal. Without this the
    // shell keeps wrapping lines at the old width.
    term.onResize(({ cols, rows }) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    // Refit when the panel changes size (this also covers window resizes).
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitAddon.fit());
    });
    observer.observe(termRef.current);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      typeahead.reset();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      typeaheadRef.current = null;
    };
  }, []);

  // Connect when sessionId is available. Each run of this effect owns the
  // sockets it opens and closes them on cleanup, so a quick change of session
  // (or React re-running the effect) can never leave a stray connection.
  //
  // A dropped connection is not the end of the sandbox: it keeps running on
  // the server. So the terminal reconnects on its own, and only reports the
  // session as over when the server says so.
  useEffect(() => {
    if (!sessionId) {
      setStatus('disconnected');
      return undefined;
    }

    let cancelled = false;
    let ws = null;
    let retryTimer = null;
    let attempts = 0;

    const print = (line) => {
      if (xtermRef.current) xtermRef.current.writeln(line);
    };

    const sessionOver = (reason) => {
      setStatus('disconnected');
      print(`\r\n\x1b[31m[Sandbox Disconnected]\x1b[0m \x1b[90m${reason} Click "Start Lab" to launch a new session.\x1b[0m`);
      if (onDisconnectRef.current) onDisconnectRef.current();
    };

    const connect = async () => {
      let url;
      try {
        url = await getTerminalWsUrl(sessionId);
      } catch {
        if (!cancelled) reconnect();
        return;
      }
      if (cancelled) return;

      const socket = new WebSocket(url);
      ws = socket;
      wsRef.current = socket;

      socket.onopen = () => {
        attempts = 0;
        setStatus('connected');
        const term = xtermRef.current;
        if (!term) return;
        // The gateway replays the recent output, so start from a clean screen.
        if (typeaheadRef.current) typeaheadRef.current.typeahead.reset();
        term.reset();
        if (fitAddonRef.current) fitAddonRef.current.fit();
        socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      };

      socket.onmessage = (event) => {
        const local = typeaheadRef.current;
        if (local) local.write(local.typeahead.output(event.data));
        else if (xtermRef.current) xtermRef.current.write(event.data);
      };

      socket.onclose = (event) => {
        if (cancelled || ws !== socket) return;
        if (SESSION_OVER_CODES.has(event.code)) {
          // The gateway says why it closed the session (stopped, idle, max_age, ...).
          sessionOver(event.reason ? `${event.reason}.` : 'Session closed.');
          return;
        }
        reconnect();
      };
    };

    // Wait a little longer each time, check the sandbox still exists, then
    // open a new socket to it.
    function reconnect() {
      if (attempts >= MAX_RECONNECT_ATTEMPTS) {
        sessionOver('The connection could not be restored.');
        return;
      }
      if (attempts === 0) print('\r\n\x1b[33m[Connection lost]\x1b[0m \x1b[90mReconnecting to your sandbox...\x1b[0m');
      setStatus('connecting');
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempts);
      attempts += 1;

      retryTimer = setTimeout(async () => {
        try {
          await sandboxApi.status(sessionId);
        } catch (err) {
          if (cancelled) return;
          // An answer from the server means the sandbox is gone; no answer
          // means the network is still down, so keep trying.
          if (err.response) sessionOver('Session closed.');
          else reconnect();
          return;
        }
        if (!cancelled) connect();
      }, delay);
    }

    setStatus('connecting');
    if (xtermRef.current) {
      xtermRef.current.reset();
      print('\x1b[1;36m[OpsAcademy Sandbox Gateway]\x1b[0m');
      print('\x1b[90mConnecting to your sandbox...\x1b[0m');
    }
    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      if (!ws) return;
      ws.onopen = null;
      ws.onclose = null;
      ws.onmessage = null;
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
        try { ws.close(); } catch { /* ignore */ }
      }
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [sessionId]);

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
});

export default Terminal;
