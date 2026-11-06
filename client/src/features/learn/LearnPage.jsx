import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Info,
  AlertTriangle,
  Lightbulb,
  Terminal,
  Loader,
  Copy,
  Check,
  Clock,
  CheckCircle2,
  Target,
} from 'lucide-react';
import { unitApi } from '../../shared/services/api';
import Quiz from './Quiz/Quiz';
import { parseInline, renderMarkdownString } from './markdown';
import './LearnPage.css';

const MERMAID_CONFIG = {
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
};

// The diagram library is large, so it is downloaded only when a lesson that
// has a diagram is opened, and only once.
let mermaidLoading = null;
function loadMermaid() {
  if (!mermaidLoading) {
    mermaidLoading = import('mermaid')
      .then(({ default: mermaid }) => {
        mermaid.initialize(MERMAID_CONFIG);
        return mermaid;
      })
      .catch((err) => {
        mermaidLoading = null; // let the next diagram try again
        throw err;
      });
  }
  return mermaidLoading;
}

let mermaidCount = 0;

/**
 * MermaidBlock — renders a mermaid chart definition as an SVG diagram.
 * Drawing waits until the block is about to scroll into view, so a long
 * lesson does not lay out every diagram before it can be read.
 */
function MermaidBlock({ chart, title }) {
  const containerRef = useRef(null);
  const [near, setNear] = useState(false);
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: '600px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return undefined;
    let cancelled = false;
    mermaidCount += 1;
    const id = `mermaid-${mermaidCount}`;

    loadMermaid()
      .then((mermaid) => mermaid.render(id, chart))
      .then(({ svg: rendered }) => {
        if (!cancelled) setSvg(rendered);
      })
      .catch((err) => {
        console.warn('Mermaid render error:', err);
        if (!cancelled) setFailed(true);
      });

    return () => { cancelled = true; };
  }, [chart, near]);

  return (
    <div className="learn-mermaid glass-card">
      {title && <h4 className="mermaid-title">{title}</h4>}
      {failed ? (
        // The diagram source is still readable when it cannot be drawn.
        <pre className="diagram-box">{chart}</pre>
      ) : (
        <div
          ref={containerRef}
          className="mermaid-container"
          style={svg ? undefined : { minHeight: 160 }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}

/** One block of an authored (array-style) section. */
function ContentBlock({ block, blockKey, unitId, copiedKey, onCopy }) {
  switch (block.type) {
    case 'text':
      return <p className="learn-paragraph">{parseInline(block.value)}</p>;

    case 'code':
      return (
        <div className="learn-code-block glass-card">
          <div className="code-header">
            <span>{block.title || 'Shell / Configuration'}</span>
            <div className="code-header-actions">
              <button className="btn btn-ghost btn-sm code-copy-btn" onClick={() => onCopy(block.value, blockKey)}>
                {copiedKey === blockKey ? (
                  <>
                    <Check size={14} className="copied-icon" /> Copied!
                  </>
                ) : (
                  <>
                    <Copy size={14} /> Copy
                  </>
                )}
              </button>
              <Link to={`/lab/${unitId}`} className="btn btn-secondary btn-sm code-run-btn">
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
        <div className={`learn-callout ${block.style}`}>
          {icons[block.style] || icons.info}
          <div className="callout-content">{parseInline(block.value)}</div>
        </div>
      );
    }

    case 'diagram':
      return (
        <div className="learn-diagram glass-card">
          {block.title && <h4>{block.title}</h4>}
          <pre className="diagram-box">{block.value}</pre>
        </div>
      );

    case 'mermaid':
      return <MermaidBlock chart={block.value} title={block.title} />;

    case 'heading':
      return block.level === 4
        ? <h4 className="learn-subheading-4">{parseInline(block.value)}</h4>
        : <h3 className="learn-subheading-3">{parseInline(block.value)}</h3>;

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className={block.ordered ? 'learn-numbered-list' : 'learn-bullet-list'}>
          {(block.items || []).map((item, i) => <li key={i}>{parseInline(item)}</li>)}
        </Tag>
      );
    }

    case 'table':
      return (
        <div className="learn-table-wrapper glass-card">
          <table className="learn-table">
            <thead><tr>{(block.header || []).map((col, i) => <th key={i}>{parseInline(col)}</th>)}</tr></thead>
            <tbody>
              {(block.rows || []).map((row, r) => (
                <tr key={r}>{row.map((cell, c) => <td key={c}>{parseInline(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    // Markdown inside a block list: lets a section mix plain markdown with the structured blocks.
    case 'markdown':
      return <>{renderMarkdownString(block.value, onCopy, copiedKey, unitId)}</>;

    default:
      return null;
  }
}

/** Who this unit is for and what it gives you, before the first paragraph. */
function UnitOverview({ meta, overview }) {
  const outcomes = overview?.outcomes?.length ? overview.outcomes : meta.objectives || [];
  return (
    <section className="learn-overview glass-card" aria-label="About this unit">
      <div className="learn-overview-facts">
        <span><Clock size={14} /> {meta.duration}</span>
        <span className={`overview-level level-${meta.difficulty}`}>{meta.difficulty}</span>
        {meta.category && <span>{meta.category}</span>}
      </div>
      {overview?.why && (
        <div className="learn-overview-why">
          <h3>Why this matters</h3>
          <p>{parseInline(overview.why)}</p>
        </div>
      )}
      <div className="learn-overview-grid">
        {outcomes.length > 0 && (
          <div>
            <h4><CheckCircle2 size={15} /> By the end you can</h4>
            <ul>{outcomes.map((o, i) => <li key={i}>{parseInline(o)}</li>)}</ul>
          </div>
        )}
        {overview?.prerequisites?.length > 0 && (
          <div>
            <h4><BookOpen size={15} /> Before you start</h4>
            <ul>{overview.prerequisites.map((o, i) => <li key={i}>{parseInline(o)}</li>)}</ul>
          </div>
        )}
      </div>
      {overview?.placementTip && (
        <p className="learn-overview-tip"><Lightbulb size={15} /> <span><strong>Placement tip.</strong> {parseInline(overview.placementTip)}</span></p>
      )}
    </section>
  );
}

/** The commands or ideas worth keeping next to you, as one table. */
function CheatSheet({ sheet }) {
  if (!sheet?.rows?.length) return null;
  return (
    <section id="cheatsheet" className="learn-section learn-cheatsheet">
      <h2 className="section-heading">{sheet.title || 'Cheat sheet'}</h2>
      <div className="learn-table-wrapper glass-card">
        <table className="learn-table">
          <thead><tr><th>{sheet.headers?.[0] || 'Command'}</th><th>{sheet.headers?.[1] || 'What it does'}</th></tr></thead>
          <tbody>
            {sheet.rows.map((row, i) => (
              <tr key={i}><td><code>{row[0]}</code></td><td>{parseInline(row[1])}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * One lesson section. Memoised, and it owns its "Copied!" state, so reading
 * (scrolling, the table of contents highlight) never re-parses the lesson.
 */
const LearnSection = memo(function LearnSection({ section, unitId }) {
  const [copiedKey, setCopiedKey] = useState(null);
  const resetTimer = useRef(null);
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const handleCopy = useCallback((text, key) => {
    // Clipboard access can be refused (permissions, insecure origin).
    Promise.resolve(navigator.clipboard?.writeText(text)).then(() => {
      setCopiedKey(key);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopiedKey(null), 2000);
    }).catch(() => {});
  }, []);

  const { content } = section;
  return (
    <section id={section.id} className="learn-section">
      <h2 className="section-heading">{section.title}</h2>
      <div className="section-blocks">
        {Array.isArray(content) && content.map((block, idx) => (
          <ContentBlock key={idx} block={block} blockKey={idx} unitId={unitId} copiedKey={copiedKey} onCopy={handleCopy} />
        ))}
        {typeof content === 'string' && renderMarkdownString(content, handleCopy, copiedKey, unitId)}
      </div>

      {Array.isArray(section.keyPoints) && section.keyPoints.length > 0 && (
        <aside className="learn-takeaways" aria-label="Key takeaways">
          <h4><Target size={15} /> Key takeaways</h4>
          <ul>{section.keyPoints.map((point, i) => <li key={i}>{parseInline(point)}</li>)}</ul>
        </aside>
      )}

      {/* Embedded Quiz */}
      {section.quiz && <Quiz quiz={section.quiz} unitId={unitId} sectionId={section.id} />}
    </section>
  );
});

/**
 * Reading progress bar. It writes the width straight to the element, at most
 * once per frame, instead of putting scroll position in React state.
 */
function ReadingProgress() {
  const barRef = useRef(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const total = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      const percent = total > 0 ? Math.min(100, (window.scrollY / total) * 100) : 0;
      if (barRef.current) barRef.current.style.width = `${percent}%`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div className="reading-progress-container">
      <div ref={barRef} className="reading-progress-bar" style={{ width: '0%' }}></div>
    </div>
  );
}

export default function LearnPage() {
  const { unitId } = useParams();
  const navigate = useNavigate();

  const [meta, setMeta] = useState(null);
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null); // null | 'not_found' | 'offline'
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [activeSection, setActiveSection] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setLoadError(null);
      try {
        const [metaRes, contentRes] = await Promise.all([
          unitApi.getMeta(unitId),
          unitApi.getMode(unitId, 'learn'),
        ]);
        if (cancelled) return;

        const contentData = contentRes.data.data;
        setMeta(metaRes.data.data);
        setContent(contentData);

        const first = (contentData.sections || contentData.modules || [])[0];
        setActiveSection(first ? first.id : '');
      } catch (err) {
        if (cancelled) return;
        // A sleeping server is not the same as a lesson that does not exist.
        setLoadError(err.response ? 'not_found' : 'offline');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [unitId, loadAttempt]);

  // Highlight the section being read in the table of contents.
  useEffect(() => {
    if (!content || typeof IntersectionObserver === 'undefined') return undefined;
    const sections = [...(content.sections || content.modules || []), ...(content.cheatsheet?.rows?.length ? [{ id: 'cheatsheet' }] : [])];
    const nodes = sections.map((sec) => document.getElementById(sec.id)).filter(Boolean);
    if (nodes.length === 0) return undefined;

    // A section is "current" while it crosses a band near the top of the screen.
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting);
      if (visible.length > 0) setActiveSection(visible[0].target.id);
    }, { rootMargin: '-15% 0px -70% 0px' });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [content]);

  if (loading) {
    return (
      <div className="learn-loading">
        <Loader size={36} className="spin" />
        <p>Loading interactive lesson...</p>
      </div>
    );
  }

  if (loadError === 'offline') {
    return (
      <div className="learn-error">
        <h2>Couldn't load this lesson</h2>
        <p>The server did not respond. If it has been idle it can take up to a minute to wake up.</p>
        <button className="btn btn-primary" onClick={() => setLoadAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }

  if (loadError || !content || !meta) {
    return (
      <div className="learn-error">
        <h2>Lesson not found</h2>
        <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  const sectionsList = content.sections || content.modules || [];

  return (
    <div className="learn-page">
      {/* Top Scroll Reading Progress Indicator */}
      <ReadingProgress />

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
          <Link to={`/lab/${unitId}`} className="btn btn-primary btn-sm">
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
            {[...sectionsList, ...(content.cheatsheet?.rows?.length ? [{ id: 'cheatsheet', title: content.cheatsheet.title || 'Cheat sheet' }] : [])].map((sec) => (
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
          <UnitOverview meta={meta} overview={content.overview} />
          {sectionsList.map((section) => (
            <LearnSection key={section.id} section={section} unitId={unitId} />
          ))}
          <CheatSheet sheet={content.cheatsheet} />

          {/* Bottom Next Action */}
          <div className="learn-footer-cta glass-card animate-fade-in-up">
            <div>
              <h3>Ready to test your skills in the shell?</h3>
              <p>Apply what you just learned in a live interactive sandbox terminal.</p>
            </div>
            <Link to={`/lab/${unitId}`} className="btn btn-primary btn-lg">
              Launch Practice Lab
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
