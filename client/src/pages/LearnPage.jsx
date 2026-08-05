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

/**
 * Helper to parse inline bold markdown: **bold text**
 */
function parseInline(text) {
  if (!text) return '';
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/**
 * Advanced Markdown String Parser (Headings, Code Blocks, Tables, Lists)
 */
function renderMarkdownString(markdownText, handleCopyCode, copiedIdx, unitId) {
  if (!markdownText) return null;

  const blocks = [];
  const lines = markdownText.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Code block
    if (line.trim().startsWith('```')) {
      const lang = line.trim().replace('```', '');
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        type: 'code',
        language: lang || 'bash',
        value: codeLines.join('\n'),
      });
      continue;
    }

    // 2. Markdown Table
    if (line.trim().startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }

      // Filter out separator line | :--- | :--- |
      const rows = tableLines
        .filter((l) => !l.match(/^\|[\s:-]+\|/))
        .map((l) =>
          l
            .split('|')
            .slice(1, -1)
            .map((cell) => cell.trim())
        );

      if (rows.length > 0) {
        const header = rows[0];
        const body = rows.slice(1);
        blocks.push({
          type: 'table',
          header,
          body,
        });
      }
      continue;
    }

    // 3. Headings
    if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', value: line.replace('### ', '').trim() });
      i++;
      continue;
    }
    if (line.startsWith('#### ')) {
      blocks.push({ type: 'h4', value: line.replace('#### ', '').trim() });
      i++;
      continue;
    }

    // 4. Bullet point lists
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      const listItems = [];
      while (
        i < lines.length &&
        (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))
      ) {
        listItems.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', items: listItems });
      continue;
    }

    // 5. Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // 6. Regular Paragraph
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('|') &&
      !lines[i].startsWith('###') &&
      !lines[i].trim().startsWith('- ') &&
      !lines[i].trim().startsWith('* ')
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', value: paraLines.join(' ') });
  }

  return blocks.map((block, idx) => {
    const key = `md-block-${idx}`;
    switch (block.type) {
      case 'h3':
        return (
          <h3 key={key} className="learn-subheading-3">
            {parseInline(block.value)}
          </h3>
        );
      case 'h4':
        return (
          <h4 key={key} className="learn-subheading-4">
            {parseInline(block.value)}
          </h4>
        );
      case 'paragraph':
        return (
          <p key={key} className="learn-paragraph">
            {parseInline(block.value)}
          </p>
        );
      case 'list':
        return (
          <ul key={key} className="learn-bullet-list">
            {block.items.map((item, itemIdx) => (
              <li key={itemIdx}>{parseInline(item)}</li>
            ))}
          </ul>
        );
      case 'code':
        return (
          <div key={key} className="learn-code-block glass-card">
            <div className="code-header">
              <span>{block.language ? `${block.language.toUpperCase()} Script / Config` : 'Shell / Configuration'}</span>
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
      case 'table':
        return (
          <div key={key} className="learn-table-wrapper glass-card">
            <table className="learn-table">
              <thead>
                <tr>
                  {block.header.map((col, cIdx) => (
                    <th key={cIdx}>{parseInline(col)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.body.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx}>{parseInline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return null;
    }
  });
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

        const metaData = metaRes.data.data;
        const contentData = contentRes.data.data;

        setMeta(metaData);
        setContent(contentData);

        const sectionsList = contentData.sections || contentData.modules || [];
        if (sectionsList.length > 0) {
          setActiveSection(sectionsList[0].id);
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

  const sectionsList = content.sections || content.modules || [];

  const renderContentBlock = (block, idx) => {
    switch (block.type) {
      case 'text':
        return (
          <p key={idx} className="learn-paragraph">
            {parseInline(block.value)}
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
            <div className="callout-content">{parseInline(block.value)}</div>
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

  const renderSectionContent = (sectionContent) => {
    if (Array.isArray(sectionContent)) {
      return sectionContent.map((block, idx) => renderContentBlock(block, idx));
    }
    if (typeof sectionContent === 'string') {
      return renderMarkdownString(sectionContent, handleCopyCode, copiedIdx, unitId);
    }
    return null;
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
            {sectionsList.map((sec) => (
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
          {sectionsList.map((section) => (
            <section key={section.id} id={section.id} className="learn-section">
              <h2 className="section-heading">{section.title}</h2>
              <div className="section-blocks">
                {renderSectionContent(section.content)}
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
              Launch Practice Lab
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
