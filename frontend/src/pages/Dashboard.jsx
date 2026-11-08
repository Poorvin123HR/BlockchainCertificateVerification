
import {
  ArrowUpRight,
  FileCheck,
  FilePlus2,
  FileX2,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { Link } from "react-router-dom";

const actions = [
  {
    title: "Verify a certificate",
    description: "Check the authenticity of an academic credential.",
    path: "/verify",
    icon: FileCheck,
    color: "blue",
  },
  {
    title: "Issue a certificate",
    description: "Register a new certificate on the blockchain.",
    path: "/issue",
    icon: FilePlus2,
    color: "green",
  },
  {
    title: "Revoke a certificate",
    description: "Invalidate a certificate issued by your institution.",
    path: "/revoke",
    icon: FileX2,
    color: "orange",
  },
];

export default function Dashboard() {
  return (
    <div className="dashboard-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">OVERVIEW</div>
          <h1>Welcome to CertiChain</h1>
          <p>Manage and verify academic credentials with blockchain technology.</p>
        </div>
        <Link to="/wallet" className="secondary-button">
          <ShieldCheck size={17} />
          Institution access
        </Link>
      </div>

      <section className="welcome-banner">
        <div className="banner-content">
          <div className="banner-tag">
            <span className="banner-tag-dot" />
            TRUSTED CREDENTIAL MANAGEMENT
          </div>
          <h2>Certificates you can trust.</h2>
          <p>
            Issue, verify and manage academic certificates with transparent,
            tamper-resistant blockchain records.
          </p>
          <Link to="/verify" className="banner-button">
            Verify a certificate <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="art-ring art-ring-one" />
          <div className="art-ring art-ring-two" />
          <div className="art-document">
            <GraduationMark />
          </div>
          <div className="art-check">
            <ShieldCheck size={25} />
          </div>
        </div>
      </section>

      <div className="section-heading">
        <div>
          <h2>System overview</h2>
          <p>Your certificate management workspace at a glance.</p>
        </div>
      </div>

      <section className="stats-grid">
        <StatCard
          label="Certificates issued"
          value="—"
          note="Live blockchain data"
          icon={FilePlus2}
          color="blue"
        />
        <StatCard
          label="Verification service"
          value="Ready to test"
          note="Contract connection pending"
          icon={FileCheck}
          color="green"
        />
        <StatCard
          label="Revocation service"
          value="Available"
          note="Issuer permissions enforced"
          icon={FileX2}
          color="orange"
        />
        <StatCard
          label="Network"
          value="Local"
          note="Hardhat development chain"
          icon={Activity}
          color="purple"
        />
      </section>

      <div className="section-heading action-heading">
        <div>
          <h2>Quick actions</h2>
          <p>Choose a task to get started.</p>
        </div>
      </div>

      <section className="quick-actions-grid">
        {actions.map(({ title, description, path, icon: Icon, color }) => (
          <Link to={path} className="action-card" key={path}>
            <div className={`action-icon ${color}`}>
              <Icon size={21} />
            </div>
            <h3>{title}</h3>
            <p>{description}</p>
            <span className="action-link">
              Open page <ArrowUpRight size={15} />
            </span>
          </Link>
        ))}
      </section>

      <section className="notice-card">
        <div className="notice-icon">
          <ShieldCheck size={20} />
        </div>
        <div>
          <strong>Blockchain security</strong>
          <p>
            Contract permissions control who can issue and revoke certificates.
            Dashboard statistics will be connected to live contract data later.
          </p>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, note, icon: Icon, color }) {
  return (
    <article className="stat-card">
      <div className="stat-card-top">
        <span>{label}</span>
        <div className={`stat-icon ${color}`}>
          <Icon size={19} />
        </div>
      </div>
      <strong className="stat-value">{value}</strong>
      <span className="stat-note">{note}</span>
    </article>
  );
}

function GraduationMark() {
  return <FileCheck size={58} strokeWidth={1.2} />;
}
