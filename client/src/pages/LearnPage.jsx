import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle,
  Code,
  Info,
  AlertTriangle,
  Lightbulb,
  Play,
  Terminal,
  Loader,
  ChevronRight,
} from 'lucide-react';
import { unitApi } from '../services/api';
import Quiz from '../components/Quiz/Quiz';
import './LearnPage.css';

export default function LearnPage() {
  const { unitId } = useParams();
  const navigate = useNavigate();

  const [meta, setMeta] = useState(null);
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('');

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

  if (loading) {
    return (
      <div className="learn-loading">
        <Loader size={36} className="spin" />
        <p>Loading lesson content...</p>
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
          <div key={idx} className="learn-code-block">
            {block.title && <div className="code-header">{block.title}</div>}
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
          <div key={idx} className="learn-diagram">
            {block.title && <h4>{block.title}</h4>}
            <pre className="diagram-box">{block.value}</pre>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="learn-page">
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
          <div className="learn-footer-cta glass-card">
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
