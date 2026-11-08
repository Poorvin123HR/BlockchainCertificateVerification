import { NavLink, Routes, Route, Navigate, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  FileCheck,
  FilePlus2,
  FileX2,
  Wallet,
  ShieldCheck,
  Bell,
  Search,
  Menu,
  GraduationCap,
  ChevronRight,
  Layers3,
} from "lucide-react";
import { useState } from "react";

import Dashboard from "./pages/Dashboard";
import VerifyCertificate from "./pages/VerifyCertificate";
import IssueCertificate from "./pages/IssueCertificate";
import RevokeCertificate from "./pages/RevokeCertificate";
import WalletPage from "./pages/Wallet";
import BatchManagement from "./pages/BatchManagement";

import "./App.css";

const navigation = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Verify Certificate", path: "/verify", icon: FileCheck },
  { label: "Issue Certificate", path: "/issue", icon: FilePlus2 },
  { label: "Revoke Certificate", path: "/revoke", icon: FileX2 },
  { label: "Batch Management", path: "/batches", icon: Layers3 },
  { label: "Wallet & Institution", path: "/wallet", icon: Wallet },
];

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <NavLink
          to="/dashboard"
          className="brand"
          onClick={() => setSidebarOpen(false)}
        >
          <span className="brand-icon">
            <GraduationCap size={25} />
          </span>
          <span className="brand-text">
            <strong>CertiChain</strong>
            <small>Certificate Portal</small>
          </span>
        </NavLink>

        <div className="sidebar-label">WORKSPACE</div>

        <nav className="sidebar-nav">
          {navigation.map(({ label, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `nav-link ${isActive ? "nav-link-active" : ""}`
              }
            >
              <Icon size={19} strokeWidth={1.9} />
              <span>{label}</span>
              {label === "Dashboard" && (
                <ChevronRight className="nav-chevron" size={16} />
              )}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="security-card">
            <div className="security-icon">
              <ShieldCheck size={21} />
            </div>
            <strong>Blockchain secured</strong>
            <p>Certificate records are protected by smart-contract rules.</p>
          </div>

          <div className="sidebar-footer">
            <span className="status-dot" />
            Local development environment
          </div>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={21} />
          </button>

          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={15} />
            <strong>Certificate Management</strong>
          </div>

          <div className="topbar-actions">
            <div className="environment-badge">
              <span className="status-dot" />
              Local network
            </div>

            <button className="icon-button" aria-label="Search">
              <Search size={19} />
            </button>

            <button className="icon-button" aria-label="Notifications">
              <Bell size={19} />
            </button>

            <div className="profile-avatar">C</div>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>

        <footer className="app-footer">
          <span>CertiChain · Blockchain Certificate Verification</span>
          <span>Built for trusted academic credentials</span>
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/verify" element={<VerifyCertificate />} />
        <Route path="/issue" element={<IssueCertificate />} />
        <Route path="/revoke" element={<RevokeCertificate />} />
        <Route path="/batches" element={<BatchManagement />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}