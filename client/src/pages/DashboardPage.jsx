import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  Clock,
  CheckCircle2,
  Terminal,
  Filter,
  BarChart3,
  BookOpen,
  Sparkles,
  Award,
  Loader,
} from 'lucide-react';
import { unitApi } from '../services/api';
import './DashboardPage.css';

const CATEGORIES = ['All', 'Linux', 'Containers', 'Web Servers', 'Scripting', 'CI/CD'];

export default function DashboardPage() {
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedDifficulty, setSelectedDifficulty] = useState('all');

  useEffect(() => {
    async function loadUnits() {
      try {
        const res = await unitApi.list();
        setUnits(res.data.data || []);
      } catch (err) {
        console.error('Failed to load units:', err);
      } finally {
        setLoading(false);
      }
    }

    loadUnits();
  }, []);

  const filteredUnits = units.filter((unit) => {
    const matchesSearch =
      unit.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      unit.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || unit.category === selectedCategory;
    const matchesDifficulty =
      selectedDifficulty === 'all' || unit.difficulty === selectedDifficulty;
    return matchesSearch && matchesCategory && matchesDifficulty;
  });

  return (
    <div className="dashboard">
      <div className="container">
        {/* ── Stats Bar ──────────────────────────────────── */}
        <div className="dashboard-stats animate-fade-in">
          <div className="stat-card glass-card">
            <div className="stat-icon icon-cyan">
              <BookOpen size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{units.length}</span>
              <span className="stat-label">Learning Units</span>
            </div>
          </div>
          <div className="stat-card glass-card">
            <div className="stat-icon icon-green">
              <CheckCircle2 size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-value">3 Modes</span>
              <span className="stat-label">Learn • Practice • Prepare</span>
            </div>
          </div>
          <div className="stat-card glass-card">
            <div className="stat-icon icon-purple">
              <BarChart3 size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-value">100%</span>
              <span className="stat-label">Placement Ready</span>
            </div>
          </div>
          <div className="stat-card glass-card">
            <div className="stat-icon icon-orange">
              <Sparkles size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-value">AI Guided</span>
              <span className="stat-label">Smart Hints & Mentoring</span>
            </div>
          </div>
        </div>

        {/* ── Filters ────────────────────────────────────── */}
        <div className="dashboard-filters animate-fade-in-up">
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              className="input search-input"
              placeholder="Search DevOps topics (Linux, Docker, CI/CD)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="filter-group">
            <div className="category-pills">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  className={`pill ${selectedCategory === cat ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="difficulty-filter">
              <Filter size={14} />
              <select
                className="input difficulty-select"
                value={selectedDifficulty}
                onChange={(e) => setSelectedDifficulty(e.target.value)}
              >
                <option value="all">All Levels</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
          </div>
        </div>

        {/* ── Units Grid ─────────────────────────────── */}
        {loading ? (
          <div className="dashboard-loading">
            <Loader size={36} className="spin" />
            <p>Loading Learning Units...</p>
          </div>
        ) : (
          <div className="labs-grid stagger-children">
            {filteredUnits.map((unit) => (
              <div key={unit.id} className="lab-card glass-card animate-fade-in-up">
                <div className="lab-card-header">
                  <span className={`badge badge-${unit.difficulty}`}>{unit.difficulty}</span>
                  <span className="lab-duration">
                    <Clock size={12} />
                    {unit.duration}
                  </span>
                </div>

                <div className="lab-card-body">
                  <h3 className="lab-card-title">{unit.title}</h3>
                  <p className="lab-card-desc">{unit.description}</p>

                  <div className="lab-objectives">
                    {unit.objectives?.slice(0, 3).map((obj, i) => (
                      <div key={i} className="lab-objective">
                        <CheckCircle2 size={12} />
                        <span>{obj}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3 Modes Action Buttons */}
                <div className="unit-modes-footer">
                  <Link
                    to={`/unit/${unit.id}/learn`}
                    className="mode-btn mode-learn"
                    title="Learn Theory"
                  >
                    <BookOpen size={14} />
                    <span>Learn</span>
                  </Link>
                  <Link
                    to={`/unit/${unit.id}/practice`}
                    className="mode-btn mode-practice"
                    title="Practice Lab Terminal"
                  >
                    <Terminal size={14} />
                    <span>Practice</span>
                  </Link>
                  <Link
                    to={`/unit/${unit.id}/prepare`}
                    className="mode-btn mode-prepare"
                    title="Interview Q&A Deck"
                  >
                    <Award size={14} />
                    <span>Prepare</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && filteredUnits.length === 0 && (
          <div className="empty-state">
            <Terminal size={48} />
            <h3>No topics found</h3>
            <p>Try adjusting your search query or filters</p>
          </div>
        )}
      </div>
    </div>
  );
}
