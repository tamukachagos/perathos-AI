"use client";

// Customer-facing invoicing panel.
//
// Lets SMB owners create and send invoices to their customers.
// This is NOT the internal metering/billing — it is a standalone invoicing
// tool for the business owner to bill their own clients.
//
// Features:
//   - List invoices with status badges (Draft | Sent | Paid | Void)
//   - Create invoice via modal form (customer, line items, VAT, due date, notes)
//   - Auto-calculates subtotal + optional 15% VAT + total
//   - Actions: View, Send via WhatsApp or email, Mark Paid, Void
//   - Revenue summary (sum of all Paid invoices)

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Eye,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  Receipt,
  Trash2,
  X,
} from "lucide-react";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface LineItem {
  description: string;
  qty: number;
  unitPrice: number;
}

interface CustomerInvoice {
  id: string;
  number: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  items: LineItem[];
  subtotalCents: string;
  taxCents: string;
  totalCents: string;
  status: string;
  dueDate: string | null;
  pdfUrl: string | null;
  paymentRef: string | null;
  notes: string | null;
  createdAt: string;
}

interface Props {
  authenticated: boolean;
  onNotice: (message: string) => void;
}

// --------------------------------------------------------------------------
// Formatting helpers
// --------------------------------------------------------------------------

function zarFormat(cents: string | number): string {
  const n = typeof cents === "string" ? parseInt(cents, 10) : cents;
  if (Number.isNaN(n)) return "R0.00";
  return `R${(n / 100).toFixed(2)}`;
}

function zarTotalFromItems(items: LineItem[], vatEnabled: boolean): {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
} {
  const subtotalRand = items.reduce((acc, it) => acc + it.qty * it.unitPrice, 0);
  const subtotalCents = Math.round(subtotalRand * 100);
  const taxCents = vatEnabled ? Math.round(subtotalCents * 0.15) : 0;
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

// --------------------------------------------------------------------------
// Status badge
// --------------------------------------------------------------------------

const STATUS_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  draft:  { color: "#32465d", bg: "#e9f1f8", label: "Draft" },
  sent:   { color: "#664608", bg: "#fff4d7", label: "Sent" },
  paid:   { color: "#0f5132", bg: "#e7f5ec", label: "Paid" },
  void:   { color: "#667085", bg: "#f3f4f6", label: "Void" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES["draft"];
  return (
    <span
      className="status-dot"
      style={{ color: s.color, background: s.bg }}
    >
      {s.label}
    </span>
  );
}

// --------------------------------------------------------------------------
// Empty line item factory
// --------------------------------------------------------------------------

function emptyItem(): LineItem {
  return { description: "", qty: 1, unitPrice: 0 };
}

// --------------------------------------------------------------------------
// New Invoice Modal
// --------------------------------------------------------------------------

interface ModalProps {
  onClose: () => void;
  onCreate: (invoice: CustomerInvoice) => void;
  onNotice: (message: string) => void;
}

function NewInvoiceModal({ onClose, onCreate, onNotice }: ModalProps) {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [items, setItems] = useState<LineItem[]>([emptyItem()]);
  const [vatEnabled, setVatEnabled] = useState(false);
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const { subtotalCents, taxCents, totalCents } = zarTotalFromItems(items, vatEnabled);

  function updateItem(index: number, field: keyof LineItem, value: string) {
    setItems((prev) =>
      prev.map((it, i) =>
        i === index
          ? {
              ...it,
              [field]:
                field === "description"
                  ? value
                  : Math.max(0, parseFloat(value) || 0),
            }
          : it,
      ),
    );
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreate() {
    setError("");
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (items.length === 0) {
      setError("Add at least one line item.");
      return;
    }
    for (const it of items) {
      if (!it.description.trim()) {
        setError("Every line item needs a description.");
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch("/api/dashboard/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName,
          customerEmail: customerEmail.trim() || null,
          customerPhone: customerPhone.trim() || null,
          items,
          vatEnabled,
          notes: notes.trim() || null,
          dueDate: dueDate || null,
        }),
      });
      const data = (await res.json()) as { ok: boolean; invoice?: CustomerInvoice; error?: string };
      if (!data.ok || !data.invoice) {
        setError(data.error ?? "Could not create invoice — please try again.");
        return;
      }
      onCreate(data.invoice);
      onNotice(`Invoice ${data.invoice.number} created.`);
      onClose();
    } catch {
      setError("Could not create invoice — please try again.");
    } finally {
      setSaving(false);
    }
  }

  // Trap focus inside modal on Escape.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="wizard-overlay" role="dialog" aria-modal="true" aria-label="New Invoice">
      <div className="wizard-panel panel" ref={dialogRef} style={{ width: "min(680px, 100%)" }}>
        <div style={{ padding: "20px 22px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 18, color: "var(--heading)", display: "flex", alignItems: "center", gap: 8 }}>
            <Receipt size={18} /> New Invoice
          </h2>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="wizard-body" style={{ padding: "20px 22px", overflowY: "auto", maxHeight: "70vh" }}>

          {error ? <p className="wizard-error">{error}</p> : null}

          {/* Customer details */}
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend style={{ fontWeight: 720, fontSize: 12, color: "var(--muted)", textTransform: "uppercase", marginBottom: 10, letterSpacing: "0.04em" }}>
              Customer
            </legend>
            <div className="wizard-fields">
              <label>
                Name *
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Thabo Nkosi"
                  autoFocus
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label>
                  Email
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="thabo@example.co.za"
                  />
                </label>
                <label>
                  Phone / WhatsApp
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="+27 71 234 5678"
                  />
                </label>
              </div>
            </div>
          </fieldset>

          {/* Line items */}
          <fieldset style={{ border: 0, margin: "18px 0 0", padding: 0 }}>
            <legend style={{ fontWeight: 720, fontSize: 12, color: "var(--muted)", textTransform: "uppercase", marginBottom: 10, letterSpacing: "0.04em" }}>
              Line Items
            </legend>

            <div style={{ display: "grid", gap: 8 }}>
              {/* Header row */}
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 70px 110px 32px", gap: 6, fontSize: 11, fontWeight: 720, color: "var(--muted)", textTransform: "uppercase" }}>
                <span>Description</span>
                <span style={{ textAlign: "center" }}>Qty</span>
                <span style={{ textAlign: "right" }}>Unit price (R)</span>
                <span />
              </div>

              {items.map((item, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 70px 110px 32px", gap: 6, alignItems: "center" }}>
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => updateItem(i, "description", e.target.value)}
                    placeholder="Service or product"
                  />
                  <input
                    type="number"
                    min="1"
                    value={item.qty}
                    onChange={(e) => updateItem(i, "qty", e.target.value)}
                    style={{ textAlign: "center" }}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(i, "unitPrice", e.target.value)}
                    style={{ textAlign: "right" }}
                    placeholder="0.00"
                  />
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => removeItem(i)}
                    disabled={items.length === 1}
                    aria-label="Remove line"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}

              <button
                className="ghost-button"
                type="button"
                onClick={addItem}
                style={{ justifySelf: "start" }}
              >
                <Plus size={14} /> Add line
              </button>
            </div>
          </fieldset>

          {/* Totals preview */}
          <div style={{ marginTop: 14, padding: "12px 14px", background: "#f8fafc", borderRadius: 8, border: "1px solid var(--border)" }}>
            <label className="field-inline" style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10, color: "var(--text)", fontWeight: 600, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={vatEnabled}
                onChange={(e) => setVatEnabled(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              Include 15% VAT
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}>
                <span>Subtotal</span>
                <span>{zarFormat(subtotalCents)}</span>
              </div>
              {vatEnabled && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}>
                  <span>VAT (15%)</span>
                  <span>{zarFormat(taxCents)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 16, borderTop: "2px solid var(--border)", paddingTop: 8, marginTop: 4, color: "var(--heading)" }}>
                <span>Total (ZAR)</span>
                <span>{zarFormat(totalCents)}</span>
              </div>
            </div>
          </div>

          {/* Due date + notes */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
            <label>
              Due date
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>
            <label>
              Notes (optional)
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Payment instructions, thank you note…"
              />
            </label>
          </div>
        </div>

        <div className="wizard-actions" style={{ padding: "14px 22px", borderTop: "1px solid var(--border)" }}>
          <button className="ghost-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={handleCreate} disabled={saving}>
            {saving ? <Loader2 size={15} className="spin" /> : <Receipt size={15} />}
            {saving ? "Creating…" : "Create invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Main InvoicingDashboard
// --------------------------------------------------------------------------

export function InvoicingDashboard({ authenticated, onNotice }: Props) {
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");

  const loadInvoices = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/invoices");
      const data = (await res.json()) as { ok: boolean; invoices?: CustomerInvoice[] };
      if (data.ok && data.invoices) setInvoices(data.invoices);
    } catch {
      // Non-critical on first load; show empty list.
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  async function updateStatus(id: string, status: string) {
    try {
      const res = await fetch("/api/dashboard/invoices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = (await res.json()) as { ok: boolean; invoice?: CustomerInvoice };
      if (data.ok && data.invoice) {
        setInvoices((prev) => prev.map((inv) => (inv.id === id ? data.invoice! : inv)));
        onNotice(`Invoice marked as ${status}.`);
      }
    } catch {
      setError("Could not update invoice — please try again.");
    }
  }

  function buildWhatsappLink(inv: CustomerInvoice): string {
    const invoiceUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/invoice/${inv.id}`;
    const total = zarFormat(inv.totalCents);
    const msg = encodeURIComponent(
      `Hi ${inv.customerName}, please find your invoice ${inv.number} for ${total} here: ${invoiceUrl}. Due: ${inv.dueDate ?? "on receipt"}.`,
    );
    const phone = inv.customerPhone?.replace(/\D/g, "") ?? "";
    return phone ? `https://wa.me/${phone}?text=${msg}` : `https://wa.me/?text=${msg}`;
  }

  function buildEmailLink(inv: CustomerInvoice): string {
    const invoiceUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/invoice/${inv.id}`;
    const total = zarFormat(inv.totalCents);
    const subject = encodeURIComponent(`Invoice ${inv.number} — ${total}`);
    const body = encodeURIComponent(
      `Hi ${inv.customerName},\n\nPlease find your invoice ${inv.number} for ${total} at:\n${invoiceUrl}\n\nDue: ${inv.dueDate ?? "on receipt"}\n\nThank you.`,
    );
    return `mailto:${inv.customerEmail ?? ""}?subject=${subject}&body=${body}`;
  }

  // Revenue from paid invoices.
  const paidRevenueCents = invoices
    .filter((inv) => inv.status === "paid")
    .reduce((acc, inv) => acc + parseInt(inv.totalCents, 10), 0);

  return (
    <section className="panel" style={{ padding: "20px 22px" }}>
      <div className="section-heading">
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Receipt size={18} /> Invoicing
          </h2>
          <p>Create and send invoices to your customers. Track payments in ZAR.</p>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          {/* Revenue summary chip */}
          {invoices.some((inv) => inv.status === "paid") && (
            <span
              className="quiet-tag success"
              title="Total revenue from paid invoices"
            >
              Paid: {zarFormat(paidRevenueCents)}
            </span>
          )}
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              if (!authenticated) {
                onNotice("Sign in to create invoices.");
                return;
              }
              setModalOpen(true);
            }}
          >
            <Plus size={15} /> New Invoice
          </button>
        </div>
      </div>

      {error ? <p className="wizard-error">{error}</p> : null}

      {/* Invoice list */}
      {!authenticated ? (
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
          Sign in to create and manage invoices.
        </p>
      ) : loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 13, marginTop: 12 }}>
          <Loader2 size={16} className="spin" /> Loading invoices…
        </div>
      ) : invoices.length === 0 ? (
        <div
          style={{
            marginTop: 12,
            padding: "28px 20px",
            border: "1px dashed var(--border)",
            borderRadius: 10,
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          No invoices yet. Click <strong>New Invoice</strong> to create your first one.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
            <thead>
              <tr>
                {["Number", "Customer", "Total", "Status", "Due date", "Actions"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      borderBottom: "2px solid var(--border)",
                      fontSize: 11,
                      fontWeight: 720,
                      textTransform: "uppercase",
                      color: "var(--muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td style={{ padding: "10px 10px", fontWeight: 700, color: "var(--heading)" }}>
                    {inv.number}
                  </td>
                  <td style={{ padding: "10px 10px" }}>
                    <div style={{ fontWeight: 600, color: "var(--heading)" }}>{inv.customerName}</div>
                    {inv.customerEmail ? (
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>{inv.customerEmail}</div>
                    ) : null}
                  </td>
                  <td style={{ padding: "10px 10px", fontWeight: 700, color: "var(--heading)", whiteSpace: "nowrap" }}>
                    {zarFormat(inv.totalCents)}
                  </td>
                  <td style={{ padding: "10px 10px" }}>
                    <StatusBadge status={inv.status} />
                  </td>
                  <td style={{ padding: "10px 10px", color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>
                    {inv.dueDate
                      ? new Date(inv.dueDate).toLocaleDateString("en-ZA", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                  </td>
                  <td style={{ padding: "10px 10px" }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {/* View */}
                      <a
                        href={`/invoice/${inv.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="icon-button"
                        title="View invoice"
                        style={{ textDecoration: "none" }}
                      >
                        <Eye size={14} />
                      </a>

                      {/* Send via WhatsApp */}
                      {inv.status !== "void" && (
                        <a
                          href={buildWhatsappLink(inv)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="icon-button"
                          title="Send via WhatsApp"
                          style={{ textDecoration: "none", color: "#25d366" }}
                          onClick={() => {
                            if (inv.status === "draft") {
                              void updateStatus(inv.id, "sent");
                            }
                          }}
                        >
                          <MessageCircle size={14} />
                        </a>
                      )}

                      {/* Send via Email */}
                      {inv.status !== "void" && inv.customerEmail && (
                        <a
                          href={buildEmailLink(inv)}
                          className="icon-button"
                          title="Send via email"
                          style={{ textDecoration: "none" }}
                          onClick={() => {
                            if (inv.status === "draft") {
                              void updateStatus(inv.id, "sent");
                            }
                          }}
                        >
                          <Mail size={14} />
                        </a>
                      )}

                      {/* Mark Paid */}
                      {inv.status !== "paid" && inv.status !== "void" && (
                        <button
                          className="icon-button"
                          type="button"
                          title="Mark as paid"
                          style={{ color: "var(--green)" }}
                          onClick={() => void updateStatus(inv.id, "paid")}
                        >
                          <Check size={14} />
                        </button>
                      )}

                      {/* Void */}
                      {inv.status !== "void" && inv.status !== "paid" && (
                        <button
                          className="icon-button"
                          type="button"
                          title="Void invoice"
                          style={{ color: "#b42318" }}
                          onClick={() => {
                            if (confirm(`Void invoice ${inv.number}? This cannot be undone.`)) {
                              void updateStatus(inv.id, "void");
                            }
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen ? (
        <NewInvoiceModal
          onClose={() => setModalOpen(false)}
          onCreate={(inv) => setInvoices((prev) => [inv, ...prev])}
          onNotice={onNotice}
        />
      ) : null}
    </section>
  );
}
