import { LockKeyhole } from "lucide-react";
import { navItems } from "@/lib/platformData";

export function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Launch Desk navigation">
      <div className="brand-lockup">
        <div className="brand-mark">LD</div>
        <div>
          <strong>Launch Desk</strong>
          <span>AI business ops</span>
        </div>
      </div>

      <nav className="nav-list">
        {navItems.map((item, index) => {
          const Icon = item.icon;
          const isActive = index === 0;
          return (
            <button
              className={isActive ? "nav-item active" : "nav-item"}
              key={item.label}
              type="button"
              aria-current={isActive ? "page" : undefined}
              aria-disabled={isActive ? undefined : true}
              title={
                isActive
                  ? undefined
                  : "Available once the workspace is connected"
              }
            >
              <Icon size={17} strokeWidth={2.1} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="trust-strip">
        <LockKeyhole size={17} />
        <div>
          <strong>Approval-first agents</strong>
          <span>
            Domains, payments, WhatsApp blasts, and deletes require sign-off.
          </span>
        </div>
      </div>
    </aside>
  );
}
