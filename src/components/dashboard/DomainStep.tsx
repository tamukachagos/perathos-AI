"use client";

// W4 — Domain step (client, non-technical, CLIENT-SAFE per the W3 lesson).
//
// This component imports ONLY:
//   * React + icons,
//   * the server ACTIONS by reference (checkDomainAvailabilityAction /
//     runDomainGatedAction) — calling a server action from a client component is
//     the supported boundary; the action's server-only imports (registrar
//     backends, node:crypto field-crypto, the registry/action plane) stay on the
//     server and never enter the client bundle.
// It NEVER imports core/registry, the RegistrarRouter, the domain service, or the
// field-crypto helper — so no server-only module (and no UnhandledSchemeError)
// can leak into the client build.
//
// UX: type a name → "Check availability" shows .com + .co.za with ZAR prices and
// an availability tick → "Register" runs the approval-gated server action.

import { useState } from "react";
import { Check, Globe2, Loader2, ShieldCheck, X } from "lucide-react";
import type { Business } from "@/lib/types";
import {
  checkDomainAvailabilityAction,
  runDomainGatedAction,
} from "@/app/domains/actions";
import type { AvailabilityResult } from "@/integrations/domain/service";

interface Props {
  business: Business;
  authenticated: boolean;
  /** True when the tenant's plan includes a custom domain (M6 entitlement). */
  canRegister: boolean;
  onNotice: (message: string) => void;
}

export function DomainStep({ business, authenticated, canRegister, onNotice }: Props) {
  const [name, setName] = useState(business.domain ?? "");
  const [checking, setChecking] = useState(false);
  const [options, setOptions] = useState<AvailabilityResult[] | null>(null);
  const [error, setError] = useState("");
  const [registering, setRegistering] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState(false);

  async function check() {
    setError("");
    setOptions(null);
    if (!authenticated) {
      onNotice("Sign in to check and register a domain.");
      return;
    }
    if (!name.trim()) {
      setError("Type a name to check (e.g. joes-plumbing).");
      return;
    }
    setChecking(true);
    try {
      const res = await checkDomainAvailabilityAction(name);
      if (res.options.length === 0) {
        setError(res.detail ?? "No domain options for that name.");
      } else {
        setOptions(res.options);
      }
    } catch {
      setError("Could not check availability — please try again.");
    } finally {
      setChecking(false);
    }
  }

  async function register(hostname: string) {
    setError("");
    if (!canRegister) {
      onNotice("Registering a custom domain is a paid feature — upgrade to unlock it.");
      return;
    }
    if (!stepUp) {
      setError("Tick the confirmation to authorise the registration.");
      return;
    }
    setRegistering(hostname);
    try {
      const result = await runDomainGatedAction({
        verb: "domain.register",
        business,
        hostname,
        stepUp: true,
      });
      if (result.status === "denied") {
        setError(result.detail);
      } else {
        onNotice(`Registering ${hostname}: ${result.detail}`);
      }
    } catch {
      setError("Registration failed — please try again.");
    } finally {
      setRegistering(null);
    }
  }

  return (
    <section className="panel domain-step">
      <div className="section-heading">
        <div>
          <h2>
            <Globe2 size={18} /> Choose your domain
          </h2>
          <p>Find your web address — we check .co.za and .com with live prices.</p>
        </div>
      </div>

      <div className="domain-search">
        <label className="field">
          <span>Your business name or web address</span>
          <input
            type="text"
            value={name}
            placeholder="joes-plumbing"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void check();
            }}
          />
        </label>
        <button
          className="primary-button"
          type="button"
          onClick={check}
          disabled={checking}
        >
          {checking ? <Loader2 size={16} className="spin" /> : <Globe2 size={16} />}
          {checking ? "Checking…" : "Check availability"}
        </button>
      </div>

      {error ? <p className="wizard-error">{error}</p> : null}

      {options ? (
        <ul className="domain-options">
          {options.map((opt) => (
            <li key={opt.hostname} className="domain-option">
              <span className="domain-name">{opt.hostname}</span>
              <span
                className={opt.available ? "domain-avail yes" : "domain-avail no"}
              >
                {opt.available ? <Check size={14} /> : <X size={14} />}
                {opt.available ? "Available" : "Taken"}
              </span>
              <span className="domain-price">{opt.priceZar}/yr</span>
              <button
                className="ghost-button"
                type="button"
                disabled={!opt.available || registering !== null}
                onClick={() => register(opt.hostname)}
              >
                {registering === opt.hostname ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <ShieldCheck size={14} />
                )}
                Register
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {options && options.some((o) => o.available) ? (
        <label className="field field-inline domain-stepup">
          <input
            type="checkbox"
            checked={stepUp}
            onChange={(e) => setStepUp(e.target.checked)}
          />
          <span>I am the owner and I authorise registering this domain.</span>
        </label>
      ) : null}
    </section>
  );
}
