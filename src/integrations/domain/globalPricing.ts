// USD cents base pricing per TLD
export const TLD_PRICE_USD: Record<string, { register: number; renew: number }> = {
  ".com":    { register: 1200, renew: 1400 },
  ".net":    { register: 1300, renew: 1500 },
  ".org":    { register: 1200, renew: 1400 },
  ".io":     { register: 3900, renew: 4200 },
  ".co":     { register: 2900, renew: 3200 },
  ".app":    { register: 1800, renew: 2000 },
  ".dev":    { register: 1400, renew: 1600 },
  ".shop":   { register: 2400, renew: 2600 },
  ".ai":     { register: 9900, renew: 9900 },
  ".tech":   { register: 3900, renew: 4200 },
  ".co.za":  { register: 800,  renew: 900  },
  ".africa": { register: 2000, renew: 2200 },
  ".ng":     { register: 2000, renew: 2200 },
  ".ke":     { register: 2000, renew: 2200 },
  ".de":     { register: 1100, renew: 1200 },
  ".fr":     { register: 1200, renew: 1300 },
  ".uk":     { register: 1000, renew: 1100 },
  ".co.uk":  { register: 1000, renew: 1100 },
  ".com.au": { register: 1500, renew: 1700 },
  ".com.br": { register: 1800, renew: 2000 },
  ".es":     { register: 1100, renew: 1200 },
  ".it":     { register: 1100, renew: 1200 },
  ".nl":     { register: 1100, renew: 1200 },
  ".ca":     { register: 1200, renew: 1400 },
  ".jp":     { register: 2500, renew: 2800 },
  ".co.jp":  { register: 2500, renew: 2800 },
  ".kr":     { register: 2200, renew: 2400 },
  ".in":     { register: 1400, renew: 1600 },
  ".sg":     { register: 2000, renew: 2200 },
  ".eu":     { register: 1000, renew: 1100 },
};

// Currency conversion multipliers (approximate, static — use live FX for production)
const FX: Record<string, number> = {
  ZAR: 18, EUR: 0.92, GBP: 0.79, AUD: 1.52, CAD: 1.36,
  BRL: 5.1, INR: 83, JPY: 150, KRW: 1320, MXN: 17,
  NGN: 1450, KES: 130,
};

export function getTldPrice(tld: string, currency: string): { register: number; renew: number } {
  const usd = TLD_PRICE_USD[tld] ?? { register: 1500, renew: 1700 };
  if (currency === "USD") return usd;
  const rate = FX[currency];
  if (!rate) return usd;
  return {
    register: Math.round(usd.register * rate),
    renew:    Math.round(usd.renew * rate),
  };
}

export function getSuggestedTlds(countryCode: string): string[] {
  const byCountry: Record<string, string[]> = {
    ZA: [".co.za", ".africa", ".com", ".shop"],
    NG: [".ng", ".com", ".africa"],
    KE: [".ke", ".com", ".africa"],
    DE: [".de", ".com", ".eu"],
    FR: [".fr", ".com", ".eu"],
    GB: [".co.uk", ".uk", ".com"],
    AU: [".com.au", ".com"],
    BR: [".com.br", ".com"],
    MX: [".com.mx", ".mx", ".com"],
    JP: [".co.jp", ".jp", ".com"],
    KR: [".co.kr", ".kr", ".com"],
    IN: [".in", ".co.in", ".com"],
    US: [".com", ".us", ".co"],
    CA: [".ca", ".com"],
    NL: [".nl", ".com", ".eu"],
    IT: [".it", ".com", ".eu"],
    ES: [".es", ".com", ".eu"],
    AR: [".com.ar", ".com"],
    SG: [".com.sg", ".sg", ".com"],
    CN: [".com", ".cn"],
    AE: [".ae", ".com"],
  };
  return byCountry[countryCode] ?? [".com", ".co", ".shop"];
}
