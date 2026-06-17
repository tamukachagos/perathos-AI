import { ArrowUpRight } from "lucide-react";
import {
  activityFeed,
  agentTeam,
  analytics,
  providerAdapters,
} from "@/lib/platformData";

export function AnalyticsPanel() {
  return (
    <section className="panel analytics-panel">
      <div className="section-heading">
        <div>
          <h2>Analytics</h2>
          <p>Plain-language growth signals, not a maze of charts.</p>
        </div>
      </div>
      <div className="metric-grid">
        {analytics.map((item) => (
          <div className={`metric-card metric-${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.change} this month</small>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AgentOps({ agentRuns }: { agentRuns: number }) {
  return (
    <section className="panel agent-panel">
      <div className="section-heading">
        <div>
          <h2>AI Updates</h2>
          <p>A single customer assistant, backed by specialist internal agents.</p>
        </div>
        <span className="quiet-tag">{agentRuns} runs</span>
      </div>
      <div className="agent-list">
        {agentTeam.map((agent) => {
          const Icon = agent.icon;
          return (
            <article key={agent.title}>
              <Icon size={18} />
              <div>
                <strong>{agent.title}</strong>
                <p>{agent.body}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ArchitecturePanel() {
  return (
    <section className="panel architecture-panel">
      <div className="section-heading">
        <div>
          <h2>System Spine</h2>
          <p>Fast MVP now, enterprise adapters later.</p>
        </div>
      </div>
      <div className="adapter-cloud">
        {providerAdapters.map((adapter) => (
          <span key={adapter}>{adapter}</span>
        ))}
      </div>
      <div className="activity-feed">
        {activityFeed.map((item) => (
          <div key={item}>
            <ArrowUpRight size={14} />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
