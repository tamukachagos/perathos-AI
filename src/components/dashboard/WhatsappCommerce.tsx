"use client";

// W8 — WhatsApp commerce panel (client, CLIENT-SAFE per the W3 lesson).
//
// Imports ONLY: React + icons, the WhatsApp commerce server ACTIONS by
// reference, and type-only record imports. It NEVER imports the messaging
// service runtime, the metering config, the registry, or any node:crypto
// module — so no server-only module leaks into the client bundle.
//
// UX: a simple catalog manager (add/list products with ZAR prices) + an orders
// list + "Publish catalog" (approval) and per-order "Payment link" (approval).
// wa.me click-to-chat stays the free default elsewhere; this is the paid BSP
// commerce surface.

import { useEffect, useState } from "react";
import { Link2, Loader2, MessageCircle, Package, Plus, ShoppingBag } from "lucide-react";
import type { Business } from "@/lib/types";
import type { ProductRecord, WhatsappOrderRecord } from "@/lib/db/types";
import {
  addProductAction,
  createPaymentLinkAction,
  listCatalogAction,
  listOrdersAction,
  publishCatalogAction,
} from "@/app/whatsapp/actions";

interface Props {
  business: Business;
  authenticated: boolean;
  /** True when the tenant's plan unlocks commerce (Growth+). */
  canSell: boolean;
  onNotice: (message: string) => void;
}

// ZAR cents (string from the server BigInt) → "R123.00".
function zar(cents: number | bigint): string {
  const n = typeof cents === "bigint" ? Number(cents) : cents;
  return `R${(n / 100).toFixed(2)}`;
}

export function WhatsappCommerce({ business, authenticated, canSell, onNotice }: Props) {
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [orders, setOrders] = useState<WhatsappOrderRecord[]>([]);
  const [name, setName] = useState("");
  const [priceRand, setPriceRand] = useState("");
  const [adding, setAdding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    void Promise.all([listCatalogAction(), listOrdersAction()])
      .then(([p, o]) => {
        if (!active) return;
        setProducts(p);
        setOrders(o);
      })
      .catch(() => {
        /* read-only; ignore transient errors */
      });
    return () => {
      active = false;
    };
  }, [authenticated]);

  async function addProduct() {
    setError("");
    if (!authenticated) {
      onNotice("Sign in to manage your WhatsApp catalog.");
      return;
    }
    if (!name.trim()) {
      setError("Add a product name.");
      return;
    }
    const rand = Number(priceRand);
    if (!Number.isFinite(rand) || rand < 0) {
      setError("Enter a valid price in Rand.");
      return;
    }
    setAdding(true);
    try {
      const product = await addProductAction({
        name,
        priceCents: Math.round(rand * 100),
      });
      setProducts((prev) => [product, ...prev]);
      setName("");
      setPriceRand("");
    } catch {
      setError("Could not add the product — please try again.");
    } finally {
      setAdding(false);
    }
  }

  async function publish() {
    setError("");
    if (!canSell) {
      onNotice("WhatsApp commerce is a Growth feature — upgrade to unlock it.");
      return;
    }
    if (!stepUp) {
      setError("Tick the confirmation to authorise publishing your catalog.");
      return;
    }
    setPublishing(true);
    try {
      const result = await publishCatalogAction(business, true);
      if (result.status === "denied") setError(result.detail);
      else onNotice(result.detail);
    } catch {
      setError("Could not publish the catalog — please try again.");
    } finally {
      setPublishing(false);
    }
  }

  async function makePaymentLink(orderId: string) {
    setError("");
    if (!canSell) {
      onNotice("WhatsApp commerce is a Growth feature — upgrade to unlock it.");
      return;
    }
    if (!stepUp) {
      setError("Tick the confirmation to authorise creating a payment link.");
      return;
    }
    setLinking(orderId);
    try {
      const result = await createPaymentLinkAction(business, orderId, true);
      if (result.status === "denied") {
        setError(result.detail);
      } else {
        if (result.order) {
          setOrders((prev) =>
            prev.map((o) => (o.id === result.order!.id ? result.order! : o)),
          );
        }
        onNotice(`${result.detail}${result.url ? ` ${result.url}` : ""}`);
      }
    } catch {
      setError("Could not create the payment link — please try again.");
    } finally {
      setLinking(null);
    }
  }

  return (
    <section className="panel whatsapp-commerce">
      <div className="section-heading">
        <div>
          <h2>
            <ShoppingBag size={18} /> Sell on WhatsApp
          </h2>
          <p>
            List products, take orders, and send a ZAR payment link — right inside
            WhatsApp. Free click-to-chat stays on your site.
          </p>
        </div>
      </div>

      {error ? <p className="wizard-error">{error}</p> : null}

      <div className="wa-catalog">
        <h3>
          <Package size={15} /> Your catalog
        </h3>
        <div className="wa-add-product">
          <label className="field">
            <span>Product</span>
            <input
              type="text"
              value={name}
              placeholder="e.g. Haircut"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Price (R)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={priceRand}
              placeholder="150.00"
              onChange={(e) => setPriceRand(e.target.value)}
            />
          </label>
          <button
            className="ghost-button"
            type="button"
            onClick={addProduct}
            disabled={adding}
          >
            {adding ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
            Add
          </button>
        </div>
        {products.length === 0 ? (
          <p className="wizard-hint">No products yet — add your first one above.</p>
        ) : (
          <ul className="wa-product-list">
            {products.map((p) => (
              <li key={p.id}>
                <span className="wa-product-name">{p.name}</span>
                <span className="wa-product-price">{zar(p.priceCents)}</span>
                <span className={p.available ? "wa-avail yes" : "wa-avail no"}>
                  {p.available ? "Available" : "Hidden"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="wa-orders">
        <h3>
          <MessageCircle size={15} /> Orders
        </h3>
        {orders.length === 0 ? (
          <p className="wizard-hint">No orders yet.</p>
        ) : (
          <ul className="wa-order-list">
            {orders.map((o) => (
              <li key={o.id}>
                <span className="wa-order-contact">{o.customerContact}</span>
                <span className="wa-order-total">{zar(o.totalCents)}</span>
                <span className="wa-order-status">{o.status}</span>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={linking !== null || Boolean(o.paymentLinkRef)}
                  onClick={() => makePaymentLink(o.id)}
                >
                  {linking === o.id ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Link2 size={14} />
                  )}
                  {o.paymentLinkRef ? "Link sent" : "Payment link"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="field field-inline wa-stepup">
        <input
          type="checkbox"
          checked={stepUp}
          onChange={(e) => setStepUp(e.target.checked)}
        />
        <span>I authorise publishing my catalog / sending payment links.</span>
      </label>
      <button
        className="primary-button"
        type="button"
        onClick={publish}
        disabled={publishing}
      >
        {publishing ? <Loader2 size={16} className="spin" /> : <ShoppingBag size={16} />}
        {publishing ? "Publishing…" : "Publish catalog to WhatsApp"}
      </button>
    </section>
  );
}
