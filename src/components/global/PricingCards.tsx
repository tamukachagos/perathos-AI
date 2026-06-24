"use client";
import { useState } from "react";
import { formatCents, getPlanPrice } from "@/lib/global/currency";
import { CURRENCY_META } from "@/lib/global/config";

interface Props {
  currency: string;
  locale: string;
  prices: { free: number; growth: number; pro: number };
}

const MAJOR_CURRENCIES = ["USD","EUR","GBP","AUD","CAD","BRL","ZAR","NGN","KES","INR","JPY","KRW","MXN","ARS"];

const FEATURES = {
  free: ["AI website builder","1 published site","WhatsApp click-to-chat","Basic lead form","Perathos subdomain"],
  growth: ["Everything in Free","Custom domain (.com, .co.za, etc.)","WhatsApp commerce","Booking system","Social media scheduling","Email marketing","CRM","Invoicing","Monthly analytics"],
  pro: ["Everything in Growth","Always-on AI agent team","8 autonomous marketing agents","Advanced analytics","Priority support","White-label option","Custom integrations"],
};

export function PricingCards({ currency: initCurrency, locale, prices: initPrices }: Props) {
  const [currency, setCurrency] = useState(initCurrency);
  const prices = {
    free: 0,
    growth: getPlanPrice("growth", currency),
    pro: getPlanPrice("pro", currency),
  };

  function handleCurrencyChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setCurrency(e.target.value);
    void fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currency: e.target.value }),
    });
  }

  return (
    <>
      <div className="pricing-grid">
        {(["free","growth","pro"] as const).map((plan) => (
          <div key={plan} className={`pricing-card${plan === "growth" ? " featured" : ""}`}>
            {plan === "growth" && <span className="pricing-badge">Most Popular</span>}
            <div className="pricing-plan-name">{plan.charAt(0).toUpperCase() + plan.slice(1)}</div>
            <div className="pricing-price">
              {prices[plan] === 0 ? "Free" : formatCents(prices[plan], currency)}
              {prices[plan] > 0 && <span> / mo</span>}
            </div>
            <ul className="pricing-features">
              {FEATURES[plan].map((f) => <li key={f}>{f}</li>)}
            </ul>
            <a href="/sign-in" className={`pricing-cta ${plan === "growth" ? "primary" : "ghost"}`}>
              {plan === "free" ? "Get started free" : `Start ${plan.charAt(0).toUpperCase() + plan.slice(1)}`}
            </a>
          </div>
        ))}
      </div>
      <div className="pricing-currency-switch">
        Show prices in:{" "}
        <select value={currency} onChange={handleCurrencyChange}>
          {MAJOR_CURRENCIES.filter(c => CURRENCY_META[c]).map(c => (
            <option key={c} value={c}>{c} ({CURRENCY_META[c].symbol})</option>
          ))}
        </select>
      </div>
    </>
  );
}
