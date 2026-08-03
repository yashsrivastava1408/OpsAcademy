import { useState, useEffect, useRef } from 'react';
import mermaid from 'mermaid';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Info,
  AlertTriangle,
  Lightbulb,
  Terminal,
  Loader,
  ChevronRight,
  Copy,
  Check,
} from 'lucide-react';
import { unitApi } from '../services/api';
import Quiz from '../components/Quiz/Quiz';
import './LearnPage.css';

/**
 * MermaidBlock — renders a mermaid chart definition as an interactive SVG diagram.
 */
function MermaidBlock({ chart, title }) {
  const containerRef = useRef(null);
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;

    mermaid.render(id, chart).then(({ svg: rendered }) => {
      if (!cancelled) setSvg(rendered);
    }).catch((err) => {
      console.warn('Mermaid render error:', err);
      if (!cancelled) setSvg(`<pre style="color:#f87171">${chart}</pre>`);
    });

    return () => { cancelled = true; };
  }, [chart]);

  return (
    <div className="learn-mermaid glass-card">
      {title && <h4 className="mermaid-title">{title}</h4>}
      <div
        ref={containerRef}
        className="mermaid-container"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

export default function LearnPage() {
  const { unitId } = useParams();
  const navigate = useNavigate();

  const [meta, setMeta] = useState(null);
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('');
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const mermaidInitialized = useRef(false);

  // Initialize mermaid once
  useEffect(() => {
    if (!mermaidInitialized.current) {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          primaryColor: '#1a2332',
          primaryTextColor: '#e2e8f0',
          primaryBorderColor: '#00d4ff',
          lineColor: '#00d4ff',
          secondaryColor: '#0f1923',
          tertiaryColor: '#162231',
          fontFamily: 'Inter, sans-serif',
          fontSize: '14px',
          nodeBorder: '#00d4ff',
          clusterBkg: '#0f1923',
          clusterBorder: '#00d4ff33',
          edgeLabelBackground: '#0d1117',
          actorBkg: '#1a2332',
          actorBorder: '#00d4ff',
          actorTextColor: '#e2e8f0',
          signalColor: '#00d4ff',
          signalTextColor: '#e2e8f0',
          labelBoxBkgColor: '#1a2332',
          labelBoxBorderColor: '#00d4ff',
          labelTextColor: '#e2e8f0',
          noteBkgColor: '#162231',
          noteTextColor: '#e2e8f0',
          noteBorderColor: '#00d4ff33',
        },
      });
      mermaidInitialized.current = true;
    }
  }, []);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [metaRes, contentRes] = await Promise.all([
          unitApi.getMeta(unitId),
          unitApi.getMode(unitId, 'learn'),
        ]);

        setMeta(metaRes.data.data);
        setContent(contentRes.data.data);

        if (contentRes.data.data.sections?.length > 0) {
          setActiveSection(contentRes.data.data.sections[0].id);
        }
      } catch (err) {
        console.error('Failed to load learn content:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [unitId]);

  // Track scroll reading progress bar
  useEffect(() => {
    const handleScroll = () => {
      const totalHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      if (totalHeight > 0) {
        const currentProgress = (window.scrollY / totalHeight) * 100;
        setScrollProgress(currentProgress);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleCopyCode = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  if (loading) {
    return (
      <div className="learn-loading">
        <Loader size={36} className="spin" />
        <p>Loading interactive lesson...</p>
      </div>
    );
  }

  if (!content || !meta) {
    return (
      <div className="learn-error">
        <h2>Lesson not found</h2>
        <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  const renderContentBlock = (block, idx) => {
    switch (block.type) {
      case 'text':
        return (
          <p key={idx} className="learn-paragraph">
            {block.value}
          </p>
        );

      case 'code':
        return (
          <div key={idx} className="learn-code-block glass-card">
            <div className="code-header">
              <span>{block.title || 'Shell / Configuration'}</span>
              <div className="code-header-actions">
                <button
                  className="btn btn-ghost btn-sm code-copy-btn"
                  onClick={() => handleCopyCode(block.value, idx)}
                >
                  {copiedIdx === idx ? (
                    <>
                      <Check size={14} className="copied-icon" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy size={14} /> Copy
                    </>
                  )}
                </button>
                <Link to={`/unit/${unitId}/practice`} className="btn btn-secondary btn-sm code-run-btn">
                  <Terminal size={12} /> Run in Shell
                </Link>
              </div>
            </div>
            <pre>
              <code>{block.value}</code>
            </pre>
          </div>
        );

      case 'callout': {
        const icons = {
          info: <Info size={18} className="callout-icon info" />,
          tip: <Lightbulb size={18} className="callout-icon tip" />,
          warning: <AlertTriangle size={18} className="callout-icon warning" />,
        };

        return (
          <div key={idx} className={`learn-callout ${block.style}`}>
            {icons[block.style] || icons.info}
            <div className="callout-content">{block.value}</div>
          </div>
        );
      }

      case 'diagram':
        return (
          <div key={idx} className="learn-diagram glass-card">
            {block.title && <h4>{block.title}</h4>}
            <pre className="diagram-box">{block.value}</pre>
          </div>
        );

      case 'mermaid':
        return <MermaidBlock key={idx} chart={block.value} title={block.title} />;

      default:
        return null;
    }
  };

  return (
    <div className="learn-page">
      {/* Top Scroll Reading Progress Indicator */}
      <div className="reading-progress-container">
        <div className="reading-progress-bar" style={{ width: `${scrollProgress}%` }}></div>
      </div>

      {/* Header */}
      <div className="learn-header">
        <div className="container learn-header-inner">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/dashboard')}>
            <ArrowLeft size={16} /> Dashboard
          </button>
          <div className="learn-header-title">
            <span className="learn-badge">Mode: Learn (Theory)</span>
            <h1>{meta.title}</h1>
          </div>
          <Link to={`/unit/${unitId}/practice`} className="btn btn-primary btn-sm">
            <Terminal size={14} /> Practice Lab
          </Link>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="container learn-container">
        {/* Sidebar Nav */}
        <aside className="learn-sidebar">
          <h3>Table of Contents</h3>
          <nav className="toc-nav">
            {content.sections.map((sec) => (
              <a
                key={sec.id}
                href={`#${sec.id}`}
                className={`toc-item ${activeSection === sec.id ? 'active' : ''}`}
                onClick={() => setActiveSection(sec.id)}
              >
                <BookOpen size={14} />
                <span>{sec.title}</span>
              </a>
            ))}
          </nav>
        </aside>

        {/* Lesson Body */}
        <main className="learn-body">
          {content.sections.map((section) => (
            <section key={section.id} id={section.id} className="learn-section">
              <h2 className="section-heading">{section.title}</h2>
              <div className="section-blocks">
                {section.content.map((block, idx) => renderContentBlock(block, idx))}
              </div>

              {/* Embedded Quiz */}
              {section.quiz && <Quiz quiz={section.quiz} />}
            </section>
          ))}

          {/* Bottom Next Action */}
          <div className="learn-footer-cta glass-card animate-fade-in-up">
            <div>
              <h3>Ready to test your skills in the shell?</h3>
              <p>Apply what you just learned in a live interactive sandbox terminal.</p>
            </div>
            <Link to={`/unit/${unitId}/practice`} className="btn btn-primary btn-lg">
              Start Practice Lab <ChevronRight size={18} />
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
