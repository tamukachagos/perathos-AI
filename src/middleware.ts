import { NextRequest, NextResponse } from "next/server";
import { detectFromHeaders } from "@/lib/global/regionDetect";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const cookieLocale = req.cookies.get("perathos_locale")?.value;
  const cookieCurrency = req.cookies.get("perathos_currency")?.value;

  const detected = detectFromHeaders(req.headers);
  const locale = cookieLocale ?? detected.locale;
  const currency = cookieCurrency ?? detected.currency;

  res.headers.set("x-detected-country",  detected.countryCode);
  res.headers.set("x-detected-locale",   locale);
  res.headers.set("x-detected-currency", currency);
  res.headers.set("x-detected-region",   detected.region);
  res.headers.set("x-detected-timezone", detected.timezone);
  res.headers.set("x-text-dir",          locale === "ar" ? "rtl" : "ltr");

  return res;
}

export const config = {
  matcher: ["/((?!api/webhooks|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
