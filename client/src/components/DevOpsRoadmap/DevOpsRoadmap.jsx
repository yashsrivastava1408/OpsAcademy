import { Link } from 'react-router-dom';
import { BookOpen, Brain } from 'lucide-react';
import { ROADMAP_DATA } from '../../data/roadmapData';

/** The 13-week pathway as one card per stage, in the landing page's card style. Theory only: labs live in Lab Studio. */
export default function DevOpsRoadmap({ units = [] }) {
  const titleOf = (unitId) => units.find((u) => u.id === unitId)?.title || unitId;

  return (
    <div className="oa-grid">
      {ROADMAP_DATA.map((step) => (
        <article key={step.stage} className="oa-card">
          <div className="oa-card-head">
            <div className="oa-card-icon">{step.icon}</div>
            <div>
              <div className="oa-card-kicker">Stage {step.stage} · {step.week}</div>
              <h3 className="oa-card-title">{step.title}</h3>
            </div>
          </div>
          <p className="oa-card-sub">{step.subtitle}</p>
          <div className="oa-card-chips">
            {step.skills.map((skill) => <span key={skill} className="oa-chip">{skill}</span>)}
          </div>
          <div className="oa-card-foot">
            {step.linkedUnitIds.slice(0, 2).map((unitId) => (
              <div key={unitId} className="oa-unit-row">
                <span>{titleOf(unitId)}</span>
                <span className="oa-unit-actions">
                  <Link to={`/unit/${unitId}/learn`} className="oa-link"><BookOpen size={12} /> Learn</Link>
                  <Link to={`/unit/${unitId}/prepare`} className="oa-link is-quiet"><Brain size={12} /> Prepare</Link>
                </span>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
