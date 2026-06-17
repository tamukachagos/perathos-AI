import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { hasDatabase } from "@/lib/env";

// Sign-in page. In mock mode it shows a one-click dev sign-in (no email, no DB);
// in Postgres mode it sends a magic link via the Nodemailer provider. Either
// way, on success we land back on the dashboard, which migrates the local draft.
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

  const dbMode = hasDatabase();

  return (
    <main className="published-shell missing-site">
      <section className="missing-site-panel">
        <h1>Sign in to Launch Desk</h1>
        {dbMode ? (
          <p>We will email you a secure magic link — no password needed.</p>
        ) : (
          <p>
            Mock mode: sign in instantly with any email. No database, no email
            delivery, no secrets required.
          </p>
        )}

        {sent ? (
          <p className="lead-confirm" role="status">
            Check your inbox for a sign-in link.
          </p>
        ) : null}

        <form action={dbMode ? magicLink : devSignIn} className="lead-form">
          <label>
            Email
            <input
              type="email"
              name="email"
              placeholder="owner@example.com"
              required={dbMode}
            />
          </label>
          <button className="public-primary" type="submit">
            {dbMode ? "Email me a link" : "Sign in (dev)"}
          </button>
        </form>
      </section>
    </main>
  );
}
