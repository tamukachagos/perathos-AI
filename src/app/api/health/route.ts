import { NextResponse } from "next/server";
import { BUILD_SHA, BUILD_SHA_SHORT, BUILD_TIME } from "@/lib/buildInfo";

// Health + build-version endpoint. Reports which commit is live and which real
// integrations are configured — booleans only, NEVER secret values — so you can
// confirm a deploy is current and see activation status at a glance.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    commit: BUILD_SHA_SHORT,
    commitFull: BUILD_SHA,
    builtAt: BUILD_TIME,
    now: new Date().toISOString(),
    // Activation status — presence checks only, no secret material is exposed.
    integrations: {
      database: Boolean(process.env.DATABASE_URL),
      auth: Boolean(process.env.AUTH_SECRET),
      ai: Boolean(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY),
      payments: Boolean(process.env.PAYSTACK_SECRET_KEY),
      github: Boolean(process.env.GITHUB_APP_ID),
      vercelDeploy: Boolean(process.env.VERCEL_TOKEN),
      domainsZa: Boolean(process.env.REGISTRAR_ZA_API_KEY),
      domainsGtld: Boolean(process.env.REGISTRAR_GTLD_API_KEY),
      gbp: Boolean(process.env.GOOGLE_GBP_CLIENT_ID),
      whatsappBsp: Boolean(process.env.WHATSAPP_BSP_API_KEY),
      managedHosting: Boolean(
        process.env.FLY_API_TOKEN ||
          process.env.RAILWAY_API_TOKEN ||
          process.env.HETZNER_API_TOKEN ||
          process.env.K8S_OPERATOR_KUBECONFIG,
      ),
    },
  });
}
