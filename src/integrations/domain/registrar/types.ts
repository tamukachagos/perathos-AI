// W4 — Registrar backend contract (ENTERPRISE_REVIEW §5.1).
//
// The single `DomainProvider` ProviderAdapter stays the public face. Behind it,
// a RegistrarRouter selects ONE RegistrarBackend per TLD:
//   * .co.za / *.za  → a ZACR-accredited SA registrar (EPP / auth-info transfers)
//   * .com & gTLDs    → an international gTLD reseller API
//
// A backend is SERVER-ONLY: it may hold registrar API keys and (when live) do
// outbound HTTP. In W4 both backends are MOCK — deterministic, no network, no
// keys — and the real ones are dormant behind documented env vars.
//
// Money note: prices are quoted in ZAR cents (integer) to match the rest of the
// billing surface (the wallet/metering layer works in micro-cents; the registrar
// quotes whole-cent retail prices that the verb layer converts as needed).

export type RegistrarKind = "za" | "gtld";

/** A check-availability quote for a single hostname. */
export interface AvailabilityQuote {
  hostname: string;
  available: boolean;
  /** Retail price in ZAR cents for one year (what the customer would pay). */
  priceCents: number;
  /** Wholesale cost in ZAR cents (what the operator pays the registrar). */
  costCents: number;
  /** The registrar backend that produced this quote. */
  registrar: RegistrarKind;
  /** Currency code — always ZAR in W4 (prices are localised for the SA market). */
  currency: "ZAR";
}

/** Result of starting a register/transfer/renew with the backend. */
export interface RegistrarOpResult {
  ok: boolean;
  detail: string;
  /** Backend-side reference (EPP roid / reseller order id) when started. */
  registrarRef?: string;
}

export interface RegisterInput {
  hostname: string;
  /** Years to register (default 1). */
  years?: number;
  autoRenew?: boolean;
}

export interface TransferInput {
  hostname: string;
  /** The EPP/auth-info code authorising the transfer (already DECRYPTED). */
  authCode: string;
}

export interface RenewInput {
  hostname: string;
  years?: number;
}

/**
 * A registrar backend. All methods are async (live backends do I/O). Mock
 * backends resolve deterministically with no network so the whole flow runs with
 * no keys.
 */
export interface RegistrarBackend {
  readonly kind: RegistrarKind;
  /** Human label for audit/UI (e.g. "ZACR (mock)"). */
  readonly label: string;
  checkAvailability(hostname: string): Promise<AvailabilityQuote>;
  register(input: RegisterInput): Promise<RegistrarOpResult>;
  transfer(input: TransferInput): Promise<RegistrarOpResult>;
  renew(input: RenewInput): Promise<RegistrarOpResult>;
}
