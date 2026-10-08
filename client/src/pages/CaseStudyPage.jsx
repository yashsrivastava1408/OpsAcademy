import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Award, BookOpen, Building2, CheckCircle2, Loader, Terminal, Users, Wrench } from 'lucide-react';
import { unitApi } from '../services/api';
import { renderMarkdownString } from '../lib/markdown';
import './LearnPage.css';
import './ExtraPages.css';

const noCopy = () => {};

/**
 * A unit's case study. Content comes in two shapes: a written post-mortem
 * (`sections` of Markdown) or a set of short cases (`caseStudies` cards).
 */
export default function CaseStudyPage() {
  const { unitId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', meta: null, study: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', meta: null, study: null });
    Promise.all([unitApi.getMeta(unitId), unitApi.getMode(unitId, 'casestudy')])
      .then(([metaRes, studyRes]) => {
        if (!cancelled) setState({ status: 'ready', meta: metaRes.data.data, study: studyRes.data.data });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: err.response ? 'not_found' : 'offline', meta: null, study: null });
      });
    return () => { cancelled = true; };
  }, [unitId, attempt]);

  if (state.status === 'loading') {
    return (
      <div className="learn-loading">
        <Loader size={36} className="spin" />
        <p>Loading case study...</p>
      </div>
    );
  }

  if (state.status === 'offline') {
    return (
      <div className="learn-error">
        <h2>Couldn't load this case study</h2>
        <p>The server did not respond. If it has been idle it can take up to a minute to wake up.</p>
        <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  }

  if (state.status === 'not_found') {
    return (
      <div className="learn-error">
        <h2>This unit has no case study</h2>
        <button className="btn btn-primary" onClick={() => navigate('/casestudies')}>All case studies</button>
      </div>
    );
  }

  const { meta, study } = state;
  const sections = study.sections || [];
  const cases = study.caseStudies || [];

  return (
    <div className="learn-page">
      <div className="learn-header">
        <div className="container learn-header-inner">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/casestudies')}>
            <ArrowLeft size={16} /> Case Studies
          </button>
          <div className="learn-header-title">
            <span className="learn-badge">Mode: Case Study</span>
            <h1>{study.title || meta.title}</h1>
          </div>
          <Link to={`/unit/${unitId}/practice`} className="btn btn-primary btn-sm">
            <Terminal size={14} /> Practice Lab
          </Link>
        </div>
      </div>

      <div className="container case-study-body">
        {(study.authorRole || study.anonymizedDomain) && (
          <p className="case-study-context">
            {study.authorRole}{study.authorRole && study.anonymizedDomain ? ' · ' : ''}{study.anonymizedDomain}
          </p>
        )}

        {sections.map((section) => (
          <section key={section.id} id={section.id} className="learn-section">
            <h2 className="section-heading">{section.title}</h2>
            <div className="section-blocks">
              {typeof section.content === 'string'
                ? renderMarkdownString(section.content, noCopy, null, unitId)
                : null}
            </div>
          </section>
        ))}

        {cases.map((item) => (
          <article key={item.id} className="case-card glass-card">
            <h2>{item.title}</h2>
            <div className="case-card-meta">
              {item.industry && <span><Building2 size={13} /> {item.industry}</span>}
              {item.scale && <span><Users size={13} /> {item.scale}</span>}
            </div>
            {item.problem && (
              <>
                <h3>The problem</h3>
                <p>{item.problem}</p>
              </>
            )}
            {item.tools?.length > 0 && (
              <>
                <h3><Wrench size={14} /> Tools used</h3>
                <div className="case-card-tools">
                  {item.tools.map((tool) => <span key={tool} className="case-tag-pill">{tool}</span>)}
                </div>
              </>
            )}
            {item.solution?.length > 0 && (
              <>
                <h3>What was done</h3>
                <ol>{item.solution.map((step, i) => <li key={i}>{step}</li>)}</ol>
              </>
            )}
            {item.outcomes?.length > 0 && (
              <>
                <h3>Outcome</h3>
                <ul className="case-card-outcomes">
                  {item.outcomes.map((outcome, i) => <li key={i}><CheckCircle2 size={14} /> {outcome}</li>)}
                </ul>
              </>
            )}
          </article>
        ))}

        <div className="learn-footer-cta glass-card">
          <div>
            <h3>Go deeper on this topic</h3>
            <p>Read the theory, practise it in a sandbox, or rehearse the interview questions.</p>
          </div>
          <div className="case-study-links">
            <Link to={`/unit/${unitId}/learn`} className="btn btn-secondary"><BookOpen size={14} /> Learn</Link>
            <Link to={`/unit/${unitId}/practice`} className="btn btn-primary"><Terminal size={14} /> Practice</Link>
            <Link to={`/unit/${unitId}/prepare`} className="btn btn-secondary"><Award size={14} /> Prepare</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
