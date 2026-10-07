/**
 * Every stylesheet, in one fixed order.
 *
 * Pages are loaded on demand, but their styles are not independent: classes
 * such as `.spin`, `.pill` and `.terminal-dots` are defined in one page's
 * file and used by others, and a few selectors are defined twice with the
 * later file winning. Loading the CSS with each page would make the result
 * depend on which page was opened first, so it all ships up front (about
 * 15 KB compressed) in the order below. Add new stylesheets to the end.
 */
import './index.css';
import './components/Navbar/Navbar.css';
import './pages/LandingPage.css';
import './components/CertificateModal/CertificateModal.css';
import './pages/DashboardPage.css';
import './components/DevOpsRoadmap/DevOpsRoadmap.css';
import './pages/RoadmapPage.css';
import './pages/CaseStudiesPage.css';
import './components/Quiz/Quiz.css';
import './pages/LearnPage.css';
import '@xterm/xterm/css/xterm.css';
import './components/Terminal/Terminal.css';
import './components/MentorChat/MentorChat.css';
import './components/DevOpsInspector/DevOpsInspector.css';
import './pages/LabPage.css';
import './components/Flashcard/Flashcard.css';
import './pages/PreparePage.css';
import './pages/AuthPage.css';
import './pages/VerifyPage.css';
