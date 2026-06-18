import { Check, ChevronRight, Clock3, ShieldCheck, type LucideIcon } from "lucide-react";
import type { AdapterStatus } from "@/lib/types";
import { STATUS, type EvaluatedChecklistAdapter } from "@/integrations/core/checklist";
import { checklistIcons } from "@/components/checklistIcons";

const statusMeta: Record<
  AdapterStatus,
  { label: string; className: string; icon: LucideIcon }
> = {
  [STATUS.READY]: { label: "Ready", className: "status-ready", icon: Check },
  [STATUS.REVIEW]: {
    label: "Needs approval",
    className: "status-review",
    icon: ShieldCheck,
  },
  [STATUS.PENDING]: {
    label: "Guided setup",
    className: "status-pending",
    icon: Clock3,
  },
};

interface Props {
  activeStep: string;
  adapters: EvaluatedChecklistAdapter[];
  published: boolean;
  setActiveStep: (key: string) => void;
  /** Checklist keys that have a gated ActionRouter verb behind them. */
  gatedKeys?: string[];
  /** Open the approval dialog for a gated checklist key. */
  onApprove?: (key: string) => void;
}

export function LaunchChecklist({
  activeStep,
  adapters,
  published,
  setActiveStep,
  gatedKeys = [],
  onApprove,
}: Props) {
  const selected =
    adapters.find((step) => step.key === activeStep) || adapters[0];
  const SelectedIcon = checklistIcons[selected.key];
  const selectedGated =
    gatedKeys.includes(selected.key) && selected.status === STATUS.REVIEW;

  return (
    <section className="panel checklist-panel">
      <div className="section-heading">
        <div>
          <h2>Ready to publish</h2>
          <p>Every integration is a provider adapter with audit and approval gates.</p>
        </div>
        <span className={published ? "quiet-tag success" : "quiet-tag"}>
          {published ? "Live" : "Draft"}
        </span>
      </div>

      <div className="checklist">
        {adapters.map((step) => {
          const Icon = checklistIcons[step.key];
          const meta = statusMeta[step.status];
          const StatusIcon = meta.icon;
          return (
            <button
              className={step.key === activeStep ? "check-row selected" : "check-row"}
              key={step.key}
              type="button"
              onClick={() => setActiveStep(step.key)}
            >
              <span className="check-icon">
                <Icon size={18} />
              </span>
              <span>
                <strong>{step.title}</strong>
                <small>{step.provider}</small>
              </span>
              <span className={`status-dot ${meta.className}`}>
                <StatusIcon size={13} />
                {meta.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="selected-step">
        <SelectedIcon size={20} />
        <div>
          <strong>{selected.title}</strong>
          <p>{selected.detail}</p>
        </div>
        {selectedGated && onApprove ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => onApprove(selected.key)}
          >
            <ShieldCheck size={16} />
            Approve
          </button>
        ) : (
          <ChevronRight size={18} />
        )}
      </div>
    </section>
  );
}
