// Public invoice page — /invoice/[id]
//
// Rendered server-side; fetches the invoice from the public API route.
// No auth is required. The invoice id acts as the shareable secret.
// Print-friendly via @media print styles in globals.css.

import type { Metadata } from "next";
import Link from "next/link";
import { formatCents } from "@/lib/global/currency";

export const dynamic = "force-dynamic";

interface LineItem {
  description: string;
  qty: number;
  unitPrice: number;
}

interface InvoiceData {
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
  /** ISO 4217 currency code, defaults to ZAR for backward compatibility. */
  currency?: string;
}

// ── Inline invoice translation map ───────────────────────────────────────────
const INVOICE_T: Record<string, Record<string, string>> = {
  en: { invoice_number: "Invoice #", due_date: "Due", status_paid: "PAID", status_due: "Payment Due", subtotal: "Subtotal", tax: "Tax", total: "Total", pay_now: "Pay invoice", print: "Print" },
  es: { invoice_number: "Factura #", due_date: "Vence", status_paid: "PAGADO", status_due: "Pendiente de pago", subtotal: "Subtotal", tax: "Impuesto", total: "Total", pay_now: "Pagar factura", print: "Imprimir" },
  pt: { invoice_number: "Fatura #", due_date: "Vencimento", status_paid: "PAGO", status_due: "A pagar", subtotal: "Subtotal", tax: "Imposto", total: "Total", pay_now: "Pagar fatura", print: "Imprimir" },
  fr: { invoice_number: "Facture #", due_date: "Échéance", status_paid: "PAYÉ", status_due: "En attente", subtotal: "Sous-total", tax: "Taxe", total: "Total", pay_now: "Payer la facture", print: "Imprimer" },
  de: { invoice_number: "Rechnung #", due_date: "Fällig", status_paid: "BEZAHLT", status_due: "Offen", subtotal: "Zwischensumme", tax: "Steuer", total: "Gesamt", pay_now: "Rechnung bezahlen", print: "Drucken" },
  ar: { invoice_number: "فاتورة #", due_date: "تاريخ الاستحقاق", status_paid: "مدفوع", status_due: "مستحق الدفع", subtotal: "المجموع الفرعي", tax: "ضريبة", total: "الإجمالي", pay_now: "دفع الفاتورة", print: "طباعة" },
  zh: { invoice_number: "发票 #", due_date: "到期日", status_paid: "已付款", status_due: "待付款", subtotal: "小计", tax: "税", total: "合计", pay_now: "支付发票", print: "打印" },
};

function it(locale: string, key: string): string {
  return (INVOICE_T[locale] ?? INVOICE_T["en"])[key] ?? INVOICE_T["en"][key] ?? key;
}

async function fetchInvoice(
  id: string,
): Promise<{ invoice: InvoiceData; businessName: string | null } | null> {
  try {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    const res = await fetch(`${base}/api/invoice/${id}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok: boolean;
      invoice?: InvoiceData;
      businessName?: string | null;
    };
    if (!data.ok || !data.invoice) return null;
    return { invoice: data.invoice, businessName: data.businessName ?? null };
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await fetchInvoice(id);
  if (!result) return { title: "Invoice not found" };
  return {
    title: `${result.invoice.number} — Invoice`,
    description: `Invoice for ${result.invoice.customerName}`,
  };
}

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await fetchInvoice(id);

  // Default locale — server component, no navigator; en is safe default
  const locale = "en";

  if (!result) {
    return (
      <div className="invoice-page">
        <div className="invoice-header">
          <div className="invoice-logo">Launch Desk</div>
        </div>
        <p style={{ color: "var(--muted)", marginTop: 48 }}>
          Invoice not found. The link may be incorrect or the invoice may have been removed.
        </p>
      </div>
    );
  }

  const { invoice, businessName } = result;
  const currency = invoice.currency ?? "ZAR";
  const isPaid = invoice.status === "paid";
  const isVoid = invoice.status === "void";
  const items = Array.isArray(invoice.items) ? (invoice.items as LineItem[]) : [];
  const subtotal = parseInt(invoice.subtotalCents, 10);
  const tax = parseInt(invoice.taxCents, 10);
  const total = parseInt(invoice.totalCents, 10);
  const hasVat = tax > 0;

  const dueDateLabel = invoice.dueDate
    ? new Date(invoice.dueDate).toLocaleDateString("en-ZA", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <main className="invoice-page">
      {/* Header: business name + invoice meta */}
      <div className="invoice-header">
        <div>
          <div className="invoice-logo">{businessName ?? "Launch Desk"}</div>
          {businessName ? (
            <div style={{ marginTop: 4, color: "var(--muted)", fontSize: 13 }}>
              Powered by Launch Desk
            </div>
          ) : null}
        </div>
        <div className="invoice-meta">
          <div className="invoice-number">{it(locale, "invoice_number")}{invoice.number}</div>
          <div style={{ marginTop: 6 }}>
            Issued:{" "}
            {new Date(invoice.createdAt).toLocaleDateString("en-ZA", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </div>
          {dueDateLabel ? <div>{it(locale, "due_date")}: {dueDateLabel}</div> : null}
          <div style={{ marginTop: 8 }}>
            To: <strong style={{ color: "var(--heading)" }}>{invoice.customerName}</strong>
          </div>
          {invoice.customerEmail ? (
            <div>
              <a href={`mailto:${invoice.customerEmail}`} style={{ color: "var(--muted)" }}>
                {invoice.customerEmail}
              </a>
            </div>
          ) : null}
          {invoice.customerPhone ? <div>{invoice.customerPhone}</div> : null}
        </div>
      </div>

      {/* Status banner */}
      {isPaid ? (
        <div style={{ marginBottom: 24 }}>
          <span className="invoice-status-paid">{it(locale, "status_paid")}</span>
        </div>
      ) : isVoid ? (
        <div
          style={{
            marginBottom: 24,
            padding: "6px 16px",
            background: "#f3f4f6",
            borderRadius: 100,
            display: "inline-block",
            fontWeight: 700,
            fontSize: 14,
            color: "var(--muted)",
          }}
        >
          VOID
        </div>
      ) : dueDateLabel ? (
        <div style={{ marginBottom: 24 }}>
          <span className="invoice-status-due">{it(locale, "status_due")} {dueDateLabel}</span>
        </div>
      ) : null}

      {/* Line items table */}
      <table className="invoice-table">
        <thead>
          <tr>
            <th>Description</th>
            <th style={{ textAlign: "center" }}>Qty</th>
            <th style={{ textAlign: "right" }}>Unit price</th>
            <th style={{ textAlign: "right" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i}>
              <td>{item.description}</td>
              <td style={{ textAlign: "center" }}>{item.qty}</td>
              <td style={{ textAlign: "right" }}>{formatCents(Math.round(item.unitPrice * 100), currency)}</td>
              <td style={{ textAlign: "right" }}>
                {formatCents(Math.round(item.qty * item.unitPrice * 100), currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="invoice-totals">
        <div className="invoice-total-row">
          <span style={{ color: "var(--muted)" }}>{it(locale, "subtotal")}</span>
          <span>{formatCents(subtotal, currency)}</span>
        </div>
        {hasVat ? (
          <div className="invoice-total-row">
            <span style={{ color: "var(--muted)" }}>{it(locale, "tax")} (15%)</span>
            <span>{formatCents(tax, currency)}</span>
          </div>
        ) : null}
        <div className="invoice-total-row invoice-total-grand">
          <span>{it(locale, "total")} ({currency})</span>
          <span>{formatCents(total, currency)}</span>
        </div>
      </div>

      {/* Notes */}
      {invoice.notes ? (
        <div
          style={{
            marginBottom: 28,
            padding: "14px 16px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 13,
            color: "var(--text)",
            background: "#f8fafc",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>
            Notes
          </div>
          <p style={{ margin: 0, lineHeight: 1.55 }}>{invoice.notes}</p>
        </div>
      ) : null}

      {/* Payment actions */}
      {!isPaid && !isVoid ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {invoice.paymentRef ? (
            <Link
              href={`/pay/${invoice.paymentRef}`}
              className="primary-button"
              style={{ textDecoration: "none" }}
            >
              {it(locale, "pay_now")} — {formatCents(total, currency)}
            </Link>
          ) : (
            <div
              style={{
                padding: "16px 20px",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "#f8fafc",
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              <strong style={{ color: "var(--heading)", display: "block", marginBottom: 4 }}>
                Pay via EFT
              </strong>
              <span style={{ color: "var(--muted)" }}>
                Use the invoice number <strong>{invoice.number}</strong> as your payment reference.
                Contact the sender for banking details.
              </span>
            </div>
          )}
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              // This will be stripped in print; handled by CSS @media print.
              window.print();
            }}
            style={{ cursor: "pointer" }}
          >
            {it(locale, "print")} / Save PDF
          </button>
        </div>
      ) : null}
    </main>
  );
}
