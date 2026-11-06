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
import '../components/Navbar/Navbar.css';
import '../../features/landing/LandingPage.css';
import '../../features/dashboard/CertificateModal/CertificateModal.css';
import '../../features/dashboard/DashboardPage.css';
import '../../features/roadmap/RoadmapPage.css';
import '../../features/case-studies/CaseStudiesPage.css';
import '../../features/learn/Quiz/Quiz.css';
import '../../features/learn/LearnPage.css';
import '@xterm/xterm/css/xterm.css';
import '../../features/lab/Terminal/Terminal.css';
import '../../features/lab/MentorChat/MentorChat.css';
import '../../features/lab/DevOpsInspector/DevOpsInspector.css';
import '../../features/lab/LabPage.css';
import '../../features/prepare/Flashcard/Flashcard.css';
import '../../features/prepare/PreparePage.css';
import '../../features/auth/AuthPage.css';
import '../../features/certificates/VerifyPage.css';
import './ExtraPages.css';
import '../../features/lab/LabHomePage.css';
import '../components/Splash/SplashScreen.css';
