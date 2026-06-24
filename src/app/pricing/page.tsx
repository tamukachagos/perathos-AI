import { headers } from "next/headers";
import { PricingCards } from "@/components/global/PricingCards";
import { getPlanPrice } from "@/lib/global/currency";

export const metadata = { title: "Pricing | Perathos Launch Desk" };

export default async function PricingPage() {
  const hdrs = await headers();
  const currency = hdrs.get("x-detected-currency") ?? "USD";
  const locale = hdrs.get("x-detected-locale") ?? "en";

  const prices = {
    free: 0,
    growth: getPlanPrice("growth", currency),
    pro: getPlanPrice("pro", currency),
  };

  return (
    <main className="pricing-section">
      <div className="pricing-header">
        <h1>Simple, transparent pricing</h1>
        <p>Start free. Scale as you grow. No hidden fees.</p>
      </div>
      <PricingCards currency={currency} locale={locale} prices={prices} />
    </main>
  );
}
