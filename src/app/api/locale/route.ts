import { NextRequest, NextResponse } from "next/server";
import { detectFromHeaders } from "@/lib/global/regionDetect";

export function GET(req: NextRequest) {
  const detected = detectFromHeaders(req.headers);
  return NextResponse.json({
    locale:      req.headers.get("x-detected-locale")   ?? detected.locale,
    currency:    req.headers.get("x-detected-currency") ?? detected.currency,
    region:      req.headers.get("x-detected-region")   ?? detected.region,
    countryCode: req.headers.get("x-detected-country")  ?? detected.countryCode,
    timezone:    req.headers.get("x-detected-timezone") ?? detected.timezone,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { locale?: string; currency?: string };
  const res = NextResponse.json({ ok: true });
  if (body.locale)   res.cookies.set("perathos_locale",   body.locale,   { path: "/", maxAge: 31536000 });
  if (body.currency) res.cookies.set("perathos_currency", body.currency, { path: "/", maxAge: 31536000 });
  return res;
}
