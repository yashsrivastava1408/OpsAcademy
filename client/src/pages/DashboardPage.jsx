import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Clock,
  CheckCircle2,
  ChevronRight,
  Terminal,
  Filter,
  BarChart3,
  BookOpen,
  Trophy,
} from 'lucide-react';
import './DashboardPage.css';

// Starter labs data (will move to API in Phase 2)
const LABS = [
  {
    id: 'lab-1',
    title: 'Create Your First Directory',
    description: 'Learn basic Linux file system commands: mkdir, touch, ls, and cat. Build your first project structure from the command line.',
    difficulty: 'beginner',
    duration: '10 min',
    category: 'Linux Basics',
    objectives: ['Create directories with mkdir', 'Create files with touch', 'List contents with ls', 'Write content with echo and cat'],
    completed: false,
  },
  {
    id: 'lab-2',
    title: 'Nginx Web Server Setup',
    description: 'Install and configure Nginx to serve a static HTML page. Learn about web server configuration and process management.',
    difficulty: 'intermediate',
    duration: '20 min',
    category: 'Web Servers',
    objectives: ['Install Nginx', 'Configure server blocks', 'Deploy static content', 'Test with curl'],
    completed: false,
  },
  {
    id: 'lab-3',
    title: 'Shell Scripting Fundamentals',
    description: 'Write your first bash scripts: variables, conditionals, loops, and functions. Automate repetitive tasks like a pro.',
    difficulty: 'beginner',
    duration: '15 min',
    category: 'Scripting',
    objectives: ['Create executable scripts', 'Use variables and arguments', 'Write conditional logic', 'Build loop constructs'],
    completed: false,
  },
  {
    id: 'lab-4',
    title: 'Docker Container Basics',
    description: 'Pull images, run containers, inspect logs, and manage container lifecycles. Your gateway to containerization.',
    difficulty: 'intermediate',
    duration: '25 min',
    category: 'Containers',
    objectives: ['Pull Docker images', 'Run interactive containers', 'Inspect container logs', 'Manage container lifecycle'],
    completed: false,
  },
  {
    id: 'lab-5',
    title: 'Environment Variables & Config',
    description: 'Master environment variables, dotfiles, and configuration management. Essential for 12-factor app development.',
    difficulty: 'beginner',
    duration: '12 min',
    category: 'Configuration',
    objectives: ['Set and export variables', 'Use .env files', 'Configure application settings', 'Understand PATH'],
    completed: false,
  },
  {
    id: 'lab-6',
    title: 'Build a CI/CD Pipeline',
    description: 'Create a simple CI/CD pipeline with shell scripts. Learn the concepts behind automated testing and deployment.',
    difficulty: 'advanced',
    duration: '30 min',
    category: 'CI/CD',
    objectives: ['Write test scripts', 'Build automation scripts', 'Create deployment workflows', 'Handle failure scenarios'],
    completed: false,
  },
];

const CATEGORIES = ['All', 'Linux Basics', 'Web Servers', 'Scripting', 'Containers', 'Configuration', 'CI/CD'];

export default function DashboardPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedDifficulty, setSelectedDifficulty] = useState('all');

  const filteredLabs = LABS.filter((lab) => {
    const matchesSearch = lab.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lab.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || lab.category === selectedCategory;
    const matchesDifficulty = selectedDifficulty === 'all' || lab.difficulty === selectedDifficulty;
    return matchesSearch && matchesCategory && matchesDifficulty;
  });

  const completedCount = LABS.filter((l) => l.completed).length;

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
              <span className="stat-value">{LABS.length}</span>
              <span className="stat-label">Total Labs</span>
            </div>
          </div>
          <div className="stat-card glass-card">
            <div className="stat-icon icon-green">
              <CheckCircle2 size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{completedCount}</span>
              <span className="stat-label">Completed</span>
            </div>
          </div>
          <div className="stat-card glass-card">
            <div className="stat-icon icon-purple">
              <BarChart3 size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{Math.round((completedCount / LABS.length) * 100)}%</span>
              <span className="stat-label">Progress</span>
            </div>
          </div>
          <div className="stat-card glass-card">
            <div className="stat-icon icon-orange">
              <Trophy size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-value">0</span>
              <span className="stat-label">Streak Days</span>
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
              placeholder="Search labs..."
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

        {/* ── Lab Cards Grid ─────────────────────────────── */}
        <div className="labs-grid stagger-children">
          {filteredLabs.map((lab) => (
            <div
              key={lab.id}
              className="lab-card glass-card animate-fade-in-up"
              onClick={() => navigate(`/lab/${lab.id}`)}
              role="button"
              tabIndex={0}
            >
              <div className="lab-card-header">
                <span className={`badge badge-${lab.difficulty}`}>
                  {lab.difficulty}
                </span>
                <span className="lab-duration">
                  <Clock size={12} />
                  {lab.duration}
                </span>
              </div>

              <div className="lab-card-body">
                <h3 className="lab-card-title">{lab.title}</h3>
                <p className="lab-card-desc">{lab.description}</p>

                <div className="lab-objectives">
                  {lab.objectives.slice(0, 3).map((obj, i) => (
                    <div key={i} className="lab-objective">
                      <CheckCircle2 size={12} />
                      <span>{obj}</span>
                    </div>
                  ))}
                  {lab.objectives.length > 3 && (
                    <span className="lab-more">+{lab.objectives.length - 3} more</span>
                  )}
                </div>
              </div>

              <div className="lab-card-footer">
                <span className="lab-category">{lab.category}</span>
                <button className="btn btn-primary btn-sm">
                  {lab.completed ? 'Review' : 'Start Lab'}
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {filteredLabs.length === 0 && (
          <div className="empty-state">
            <Terminal size={48} />
            <h3>No labs found</h3>
            <p>Try adjusting your search or filters</p>
          </div>
        )}
      </div>
    </div>
  );
}
