import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { getAuthMode } from "@/lib/authMode";

// Sign-in page. The rendered form now mirrors the provider list Auth.js actually
// configured, so production never offers dev sign-in or an unavailable provider.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { sent } = await searchParams;

  async function devSignIn(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    await signIn("dev", { email, redirectTo: "/?signedIn=1" });
  }

  async function magicLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    await signIn("nodemailer", { email, redirectTo: "/?signedIn=1" });
    redirect("/sign-in?sent=1");
  }

  const authMode = getAuthMode();
  const emailMode = authMode === "email";
  const mockMode = authMode === "mock";
  const unconfigured = authMode === "unconfigured";

  return (
    <main className="published-shell missing-site">
      <section className="missing-site-panel">
        <h1>Sign in to Launch Desk</h1>
        {emailMode ? (
          <p>We will email you a secure magic link. No password needed.</p>
        ) : mockMode ? (
          <p>
            Mock mode: sign in instantly with any email. No database, no email
            delivery, no secrets required.
          </p>
        ) : (
          <p>
            Sign-in setup is incomplete. Add a real database, AUTH_SECRET, and
            EMAIL_SERVER before accepting production users.
          </p>
        )}

        {sent ? (
          <p className="lead-confirm" role="status">
            Check your inbox for a sign-in link.
          </p>
        ) : null}

        {unconfigured ? (
          <p className="billing-error" role="alert">
            Production sign-in is disabled until email authentication is
            configured.
          </p>
        ) : (
          <form
            action={emailMode ? magicLink : devSignIn}
            className="lead-form"
          >
            <label>
              Email
              <input
                type="email"
                name="email"
                placeholder="owner@example.com"
                required={emailMode}
              />
            </label>
            <button className="public-primary" type="submit">
              {emailMode ? "Email me a link" : "Sign in (dev)"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
