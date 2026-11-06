import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { Loader } from 'lucide-react';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar/Navbar';

// Each page is its own chunk, so a visitor downloads only the page they open
// (the terminal and diagram libraries are large and most pages need neither).
const pages = {
  landing: () => import('./pages/LandingPage'),
  dashboard: () => import('./pages/DashboardPage'),
  roadmap: () => import('./pages/RoadmapPage'),
  caseStudies: () => import('./pages/CaseStudiesPage'),
  auth: () => import('./pages/AuthPage'),
  verify: () => import('./pages/VerifyPage'),
  learn: () => import('./pages/LearnPage'),
  lab: () => import('./pages/LabPage'),
  prepare: () => import('./pages/PreparePage'),
  caseStudy: () => import('./pages/CaseStudyPage'),
  profile: () => import('./pages/ProfilePage'),
  admin: () => import('./pages/AdminPage'),
  resetPassword: () => import('./pages/ResetPasswordPage'),
  verifyEmail: () => import('./pages/VerifyEmailPage'),
  authCallback: () => import('./pages/AuthCallbackPage'),
  labHome: () => import('./pages/LabHomePage'),
  labTransition: () => import('./pages/LabTransitionPage'),
  adminLab: () => import('./pages/AdminLabPage'),
  collegeSlots: () => import('./pages/CollegeSlotsPage'),
};

const LandingPage = lazy(pages.landing);
const DashboardPage = lazy(pages.dashboard);
const RoadmapPage = lazy(pages.roadmap);
const CaseStudiesPage = lazy(pages.caseStudies);
const AuthPage = lazy(pages.auth);
const VerifyPage = lazy(pages.verify);
const LearnPage = lazy(pages.learn);
const LabPage = lazy(pages.lab);
const PreparePage = lazy(pages.prepare);
const CaseStudyPage = lazy(pages.caseStudy);
const ProfilePage = lazy(pages.profile);
const AdminPage = lazy(pages.admin);
const ResetPasswordPage = lazy(pages.resetPassword);
const VerifyEmailPage = lazy(pages.verifyEmail);
const AuthCallbackPage = lazy(pages.authCallback);
const LabHomePage = lazy(pages.labHome);
const LabTransitionPage = lazy(pages.labTransition);
const AdminLabPage = lazy(pages.adminLab);
const CollegeSlotsPage = lazy(pages.collegeSlots);

/** The chunk for a URL, so it can start downloading before React renders. */
function pageFor(pathname) {
  if (pathname === '/') return pages.landing;
  if (pathname.startsWith('/dashboard')) return pages.dashboard;
  if (pathname.startsWith('/roadmap')) return pages.roadmap;
  if (pathname.startsWith('/casestudies')) return pages.caseStudies;
  if (pathname.startsWith('/login')) return pages.auth;
  if (pathname.startsWith('/verify/')) return pages.verify;
  if (pathname.startsWith('/admin/lab')) return pages.adminLab;
  if (pathname.startsWith('/college')) return pages.collegeSlots;
  if (pathname === '/lab') return pages.labHome;
  if (pathname.startsWith('/lab/')) return pathname.endsWith('/enter') ? pages.labTransition : pages.lab;
  if (pathname.endsWith('/learn')) return pages.learn;
  if (pathname.endsWith('/prepare')) return pages.prepare;
  if (pathname.endsWith('/casestudy')) return pages.caseStudy;
  if (pathname.startsWith('/u/')) return pages.profile;
  if (pathname.startsWith('/admin')) return pages.admin;
  if (pathname.startsWith('/reset-password')) return pages.resetPassword;
  if (pathname.startsWith('/verify-email')) return pages.verifyEmail;
  if (pathname.startsWith('/auth/callback')) return pages.authCallback;
  return null;
}

const ignore = () => {};
pageFor(window.location.pathname)?.().catch(ignore);

/** Once the first page is idle, fetch the small pages people go to next. */
function usePrefetchCommonPages() {
  useEffect(() => {
    const prefetch = () => {
      for (const load of [pages.dashboard, pages.roadmap, pages.caseStudies, pages.auth]) load().catch(ignore);
    };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(prefetch, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(prefetch, 2500);
    return () => clearTimeout(id);
  }, []);
}

/** A new page starts at the top, not where the previous one was scrolled to. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

/** Old links to /unit/:id/practice now open the lab in Lab Studio. */
function PracticeRedirect() {
  const { unitId } = useParams();
  return <Navigate to={`/lab/${encodeURIComponent(unitId)}`} replace />;
}

function PageLoading() {
  return (
    <div className="page-loading" role="status" aria-label="Loading page">
      <Loader size={32} className="spin" />
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="page-loading">
      <h2>Page not found</h2>
      <p>There is nothing at this address.</p>
      <Link to="/dashboard" className="btn btn-primary">Go to the dashboard</Link>
    </div>
  );
}

function AppRoutes() {
  usePrefetchCommonPages();
  return (
    <>
      <ScrollToTop />
      <Navbar />
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/roadmap" element={<RoadmapPage />} />
          <Route path="/casestudies" element={<CaseStudiesPage />} />
          <Route path="/login" element={<AuthPage />} />
          <Route path="/verify/:certificateId" element={<VerifyPage />} />
          <Route path="/unit/:unitId/learn" element={<LearnPage />} />
          <Route path="/unit/:unitId/practice" element={<PracticeRedirect />} />
          <Route path="/unit/:unitId/prepare" element={<PreparePage />} />
          <Route path="/unit/:unitId/casestudy" element={<CaseStudyPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/u/:slug" element={<ProfilePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/lab" element={<AdminLabPage />} />
          <Route path="/college" element={<CollegeSlotsPage />} />
          <Route path="/learn" element={<Navigate to="/dashboard" replace />} />
          <Route path="/lab" element={<LabHomePage />} />
          <Route path="/lab/:unitId/enter" element={<LabTransitionPage />} />
          <Route path="/lab/:unitId" element={<LabPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}
