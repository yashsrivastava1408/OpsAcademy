import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  CheckCircle2,
  XCircle,
  Play,
  Square,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Loader,
} from 'lucide-react';
import Terminal from '../components/Terminal/Terminal';
import { sandboxApi } from '../services/api';
import './LabPage.css';

// Lab data (same as dashboard, will be API-driven in Phase 2)
const LABS_DATA = {
  'lab-1': {
    id: 'lab-1',
    title: 'Create Your First Directory',
    difficulty: 'beginner',
    duration: '10 min',
    category: 'Linux Basics',
    instructions: [
      {
        step: 1,
        title: 'Create the project directory',
        content: 'Use the `mkdir` command to create a directory called `app` inside `/home/student`.',
        hint: 'The command is: `mkdir /home/student/app`',
        command: 'mkdir /home/student/app',
      },
      {
        step: 2,
        title: 'Create an HTML file',
        content: 'Use `echo` or a text editor to create a file called `index.html` inside the `app` directory with some HTML content.',
        hint: 'Try: `echo \'<h1>Hello World</h1>\' > /home/student/app/index.html`',
        command: 'echo \'<h1>Hello World</h1>\' > /home/student/app/index.html',
      },
      {
        step: 3,
        title: 'Verify your work',
        content: 'Use `ls` to list the contents of the `app` directory, and `cat` to display the content of your HTML file.',
        hint: 'Commands: `ls /home/student/app` and `cat /home/student/app/index.html`',
        command: 'cat /home/student/app/index.html',
      },
      {
        step: 4,
        title: 'Create a nested structure',
        content: 'Create a `css` and `js` subdirectory inside `app` using `mkdir -p`.',
        hint: 'Try: `mkdir -p /home/student/app/{css,js}`',
        command: 'mkdir -p /home/student/app/css /home/student/app/js',
      },
    ],
  },
  'lab-2': {
    id: 'lab-2',
    title: 'Nginx Web Server Setup',
    difficulty: 'intermediate',
    duration: '20 min',
    category: 'Web Servers',
    instructions: [
      {
        step: 1,
        title: 'Check if Nginx is installed',
        content: 'Run `which nginx` or `nginx -v` to check if Nginx is available in the sandbox.',
        hint: 'Command: `nginx -v`',
      },
      {
        step: 2,
        title: 'Create a static HTML page',
        content: 'Create an `index.html` file in `/home/student/www/` with a proper HTML structure.',
        hint: 'mkdir -p /home/student/www && echo content > /home/student/www/index.html',
      },
      {
        step: 3,
        title: 'Configure Nginx',
        content: 'Create or modify the Nginx config to serve your static files from `/home/student/www/`.',
        hint: 'Edit /etc/nginx/nginx.conf or create a custom config file',
      },
      {
        step: 4,
        title: 'Test the configuration',
        content: 'Run `nginx -t` to test your configuration for syntax errors.',
        hint: 'Command: `nginx -t`',
      },
    ],
  },
  'lab-3': {
    id: 'lab-3',
    title: 'Shell Scripting Fundamentals',
    difficulty: 'beginner',
    duration: '15 min',
    category: 'Scripting',
    instructions: [
      {
        step: 1,
        title: 'Create your first script',
        content: 'Create a file called `hello.sh` that prints "Hello, DevOps!" to the terminal.',
        hint: 'echo \'#!/bin/bash\\necho "Hello, DevOps!"\' > hello.sh',
      },
      {
        step: 2,
        title: 'Make it executable',
        content: 'Use `chmod` to make your script executable, then run it.',
        hint: 'chmod +x hello.sh && ./hello.sh',
      },
      {
        step: 3,
        title: 'Add variables',
        content: 'Modify your script to accept a name as an argument and greet that person.',
        hint: 'Use $1 to access the first argument',
      },
    ],
  },
  'lab-4': {
    id: 'lab-4',
    title: 'Docker Container Basics',
    difficulty: 'intermediate',
    duration: '25 min',
    category: 'Containers',
    instructions: [
      { step: 1, title: 'Check Docker version', content: 'Verify Docker is available by running `docker --version`.', hint: 'docker --version' },
      { step: 2, title: 'Pull an image', content: 'Pull the `alpine:latest` image from Docker Hub.', hint: 'docker pull alpine:latest' },
      { step: 3, title: 'Run a container', content: 'Run an Alpine container that prints "Hello from Docker!"', hint: 'docker run alpine echo "Hello from Docker!"' },
    ],
  },
  'lab-5': {
    id: 'lab-5',
    title: 'Environment Variables & Config',
    difficulty: 'beginner',
    duration: '12 min',
    category: 'Configuration',
    instructions: [
      { step: 1, title: 'View current variables', content: 'Use `env` or `printenv` to see all environment variables.', hint: 'env | head -20' },
      { step: 2, title: 'Set a variable', content: 'Set a variable called `APP_ENV` to `production`.', hint: 'export APP_ENV=production' },
      { step: 3, title: 'Create a .env file', content: 'Create a `.env` file with key-value pairs for your app config.', hint: 'echo "DB_HOST=localhost" > .env' },
    ],
  },
  'lab-6': {
    id: 'lab-6',
    title: 'Build a CI/CD Pipeline',
    difficulty: 'advanced',
    duration: '30 min',
    category: 'CI/CD',
    instructions: [
      { step: 1, title: 'Create a test script', content: 'Write a `test.sh` script that checks if your app files exist and returns proper exit codes.', hint: '#!/bin/bash\ntest -f app/index.html && echo "PASS" || echo "FAIL"' },
      { step: 2, title: 'Create a build script', content: 'Write a `build.sh` that compiles or processes your application.', hint: 'Create a script that copies files to a dist/ directory' },
      { step: 3, title: 'Create a deploy script', content: 'Write a `deploy.sh` that moves built files to a serving directory.', hint: 'cp -r dist/* /var/www/html/' },
    ],
  },
};

export default function LabPage() {
  const { labId } = useParams();
  const navigate = useNavigate();
  const lab = LABS_DATA[labId];

  const [sessionId, setSessionId] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState({});
  const [showHint, setShowHint] = useState({});
  const [elapsedTime, setElapsedTime] = useState(0);
  const [verifyResult, setVerifyResult] = useState(null);

  // Timer
  useEffect(() => {
    if (!sessionId) return;
    const interval = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionId]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const startLab = async () => {
    setIsStarting(true);
    try {
      const res = await sandboxApi.start('student', labId);
      setSessionId(res.data.data.sessionId);
      setElapsedTime(0);
    } catch (err) {
      console.error('Failed to start sandbox:', err);
      alert('Failed to start sandbox. Is the server running?');
    } finally {
      setIsStarting(false);
    }
  };

  const stopLab = async () => {
    if (sessionId) {
      try {
        await sandboxApi.stop(sessionId);
      } catch (err) {
        console.error('Failed to stop sandbox:', err);
      }
      setSessionId(null);
      setElapsedTime(0);
    }
  };

  const toggleStep = (step) => {
    setExpandedSteps((prev) => ({ ...prev, [step]: !prev[step] }));
  };

  const toggleHint = (step) => {
    setShowHint((prev) => ({ ...prev, [step]: !prev[step] }));
  };

  if (!lab) {
    return (
      <div className="lab-not-found">
        <h2>Lab not found</h2>
        <p>The lab "{labId}" doesn't exist.</p>
        <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="lab-page">
      {/* ── Lab Header ───────────────────────────────────── */}
      <div className="lab-header">
        <div className="lab-header-left">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/dashboard')}>
            <ArrowLeft size={16} />
            Back
          </button>
          <div className="lab-header-info">
            <h1 className="lab-title">{lab.title}</h1>
            <div className="lab-meta">
              <span className={`badge badge-${lab.difficulty}`}>{lab.difficulty}</span>
              <span className="lab-meta-item">
                <Clock size={12} />
                {lab.duration}
              </span>
              <span className="lab-meta-item">{lab.category}</span>
            </div>
          </div>
        </div>
        <div className="lab-header-right">
          {sessionId && (
            <span className="lab-timer">
              <Clock size={14} />
              {formatTime(elapsedTime)}
            </span>
          )}
          {!sessionId ? (
            <button
              className="btn btn-primary"
              onClick={startLab}
              disabled={isStarting}
            >
              {isStarting ? (
                <>
                  <Loader size={16} className="spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play size={16} />
                  Start Lab
                </>
              )}
            </button>
          ) : (
            <>
              <button className="btn btn-secondary btn-sm" onClick={stopLab}>
                <Square size={14} />
                Stop
              </button>
              <button className="btn btn-success btn-sm" onClick={() => setVerifyResult({ status: 'checking' })}>
                <CheckCircle2 size={14} />
                Verify
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Split Pane: Instructions | Terminal ──────────── */}
      <div className="lab-workspace">
        {/* Instructions Panel */}
        <div className="lab-instructions">
          <div className="instructions-header">
            <h2>Instructions</h2>
            <span className="instructions-count">
              {lab.instructions.length} steps
            </span>
          </div>

          <div className="instructions-list">
            {lab.instructions.map((instruction) => (
              <div
                key={instruction.step}
                className={`instruction-item ${expandedSteps[instruction.step] !== false ? 'expanded' : ''}`}
              >
                <button
                  className="instruction-header-btn"
                  onClick={() => toggleStep(instruction.step)}
                >
                  <div className="instruction-step-badge">
                    {instruction.step}
                  </div>
                  <span className="instruction-title">{instruction.title}</span>
                  {expandedSteps[instruction.step] === false ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronUp size={16} />
                  )}
                </button>

                {expandedSteps[instruction.step] !== false && (
                  <div className="instruction-content">
                    <p>{instruction.content}</p>
                    {instruction.hint && (
                      <div className="instruction-hint-area">
                        <button
                          className="btn btn-ghost btn-sm hint-toggle"
                          onClick={() => toggleHint(instruction.step)}
                        >
                          {showHint[instruction.step] ? 'Hide Hint' : 'Show Hint'}
                        </button>
                        {showHint[instruction.step] && (
                          <div className="hint-box">
                            <code>{instruction.hint}</code>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Terminal Panel */}
        <div className="lab-terminal">
          <Terminal sessionId={sessionId} onDisconnect={() => setSessionId(null)} />
        </div>
      </div>

      {/* ── Verify Result Overlay ────────────────────────── */}
      {verifyResult && (
        <div className="verify-overlay" onClick={() => setVerifyResult(null)}>
          <div className="verify-card glass-card animate-scale-in" onClick={(e) => e.stopPropagation()}>
            {verifyResult.status === 'checking' ? (
              <>
                <div className="verify-icon checking">
                  <Loader size={32} className="spin" />
                </div>
                <h3>Verifying your work...</h3>
                <p>Checking container state against lab objectives</p>
              </>
            ) : verifyResult.status === 'pass' ? (
              <>
                <div className="verify-icon pass">
                  <CheckCircle2 size={32} />
                </div>
                <h3>All checks passed! 🎉</h3>
                <p>Congratulations! You've completed this lab.</p>
              </>
            ) : (
              <>
                <div className="verify-icon fail">
                  <XCircle size={32} />
                </div>
                <h3>Some checks failed</h3>
                <p>Review the instructions and try again.</p>
              </>
            )}
            <button className="btn btn-secondary" onClick={() => setVerifyResult(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
