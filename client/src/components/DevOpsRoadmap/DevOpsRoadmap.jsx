import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Terminal,
  Brain,
  CheckCircle2,
  Play,
  Pause,
  Check,
} from 'lucide-react';
import './DevOpsRoadmap.css';

import { ROADMAP_DATA } from '../../data/roadmapData';

export default function DevOpsRoadmap({ units = [], onStepSelect, selectedStepIndex }) {
  const [internalStep, setInternalStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const activeStep = selectedStepIndex !== undefined && selectedStepIndex !== null
    ? selectedStepIndex
    : internalStep;

  useEffect(() => {
    let interval;
    if (isPlaying) {
      interval = setInterval(() => {
        const nextIndex = (activeStep + 1) % ROADMAP_DATA.length;
        setInternalStep(nextIndex);
        if (onStepSelect) {
          onStepSelect(nextIndex, ROADMAP_DATA[nextIndex]);
        }
      }, 3500);
    }
    return () => clearInterval(interval);
  }, [isPlaying, activeStep, onStepSelect]);

  const handleStageClick = (index) => {
    setIsPlaying(false);
    setInternalStep(index);
    if (onStepSelect) {
      onStepSelect(index, ROADMAP_DATA[index]);
    }
  };

  const getUnitInfo = (unitId) => {
    return units.find((u) => u.id === unitId) || { id: unitId, title: unitId, category: 'DevOps' };
  };

  return (
    <div className="vertical-pipeline-card glass-card">
      {/* ── Pipeline Header Bar ───────────────────────────────────────── */}
      <div className="pipeline-header-vertical">
        <div className="pipeline-title-group">
          <div className="pipeline-status-badge">
            <span className="live-dot" />
            <span>CI/CD Pipeline Pathway</span>
          </div>
          <h3 className="pipeline-main-title">13-Week DevOps Pipeline</h3>
        </div>

        <button
          className={`pipeline-tour-btn ${isPlaying ? 'playing' : ''}`}
          onClick={() => setIsPlaying(!isPlaying)}
        >
          {isPlaying ? <Pause size={13} /> : <Play size={13} />}
          <span>{isPlaying ? 'Pause' : 'Auto Run'}</span>
        </button>
      </div>

      {/* ── Vertical CI/CD Pipeline Stages Track (Full Stretched Height) ── */}
      <div className="vertical-stages-track-stretched">
        {ROADMAP_DATA.map((step, index) => {
          const isActive = index === activeStep;
          return (
            <div key={step.stage} className="vertical-stage-wrapper">
              <button
                className={`vertical-stage-node node-${step.color} ${isActive ? 'active' : ''}`}
                onClick={() => handleStageClick(index)}
              >
                <div className="stage-top-meta">
                  <span className="stage-num">STAGE {step.stage} • {step.week}</span>
                  <span className="stage-status-check">
                    <Check size={10} />
                  </span>
                </div>

                <div className="stage-body">
                  <div className="stage-icon">{step.icon}</div>
                  <div className="stage-text">
                    <h4 className="stage-title">{step.title}</h4>
                    <span className="stage-subtitle">{step.subtitle}</span>
                  </div>
                </div>

                {/* Skill Chips */}
                <div className="stage-skills-mini">
                  {step.skills.slice(0, 3).map((skill, i) => (
                    <span key={i} className="mini-chip">
                      <CheckCircle2 size={10} className="check-icon" />
                      {skill}
                    </span>
                  ))}
                </div>

                {/* 1-Click Launchers directly inside stage node */}
                <div className="stage-quick-launchers">
                  {step.linkedUnitIds.slice(0, 1).map((unitId) => {
                    const unit = getUnitInfo(unitId);
                    return (
                      <div key={unitId} className="stage-launch-row">
                        <span className="unit-label">{unit.title}</span>
                        <div className="launch-btns flex-gap">
                          <Link to={`/unit/${unitId}/learn`} className="btn-launch btn-learn">
                            <BookOpen size={11} /> Learn
                          </Link>
                          <Link to={`/unit/${unitId}/practice`} className="btn-launch btn-practice">
                            <Terminal size={11} /> Practice
                          </Link>
                          <Link to={`/unit/${unitId}/prepare`} className="btn-launch btn-prepare">
                            <Brain size={11} /> Prepare
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {isActive && <div className="stage-glow-beam" />}
              </button>

              {index < ROADMAP_DATA.length - 1 && (
                <div className={`vertical-connector ${isActive ? 'active-flow' : ''}`}>
                  <div className="vertical-laser-particle" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
