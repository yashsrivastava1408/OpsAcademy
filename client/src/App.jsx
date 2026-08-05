import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar/Navbar';
import LandingPage from './pages/LandingPage';
import DashboardPage from './pages/DashboardPage';
import RoadmapPage from './pages/RoadmapPage';
import CaseStudiesPage from './pages/CaseStudiesPage';
import LearnPage from './pages/LearnPage';
import LabPage from './pages/LabPage';
import PreparePage from './pages/PreparePage';

export default function App() {
  return (
    <Router>
      <Navbar />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/roadmap" element={<RoadmapPage />} />
        <Route path="/casestudies" element={<CaseStudiesPage />} />
        <Route path="/unit/:unitId/learn" element={<LearnPage />} />
        <Route path="/unit/:unitId/practice" element={<LabPage />} />
        <Route path="/unit/:unitId/prepare" element={<PreparePage />} />
        {/* Legacy route alias */}
        <Route path="/lab/:unitId" element={<LabPage />} />
      </Routes>
    </Router>
  );
}
