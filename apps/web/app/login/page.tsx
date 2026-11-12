"use client";
import { Card, Wordmark } from "@suiem/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Footer } from "../../components/AppShell";
import { PasskeyLogin, SiweLogin } from "../../components/auth";
import { safeRedirect } from "../../lib/redirect";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const done = ({ isNewUser }: { isNewUser: boolean }) => {
    const safeNext = safeRedirect(next);
    router.replace(isNewUser ? "/onboarding" : safeNext);
  };
  return (
    <main id="main" className="auth">
      <section className="auth-hero">
        <Wordmark href="/" />
        <div className="s-stack" style={{ gap: 14 }}>
          <span className="s-badge" style={{ background: "rgba(255,255,255,0.16)", color: "#fff" }}>
            Research before you invest
          </span>
          <h1>
            Research first, invest with <em>conviction</em>
          </h1>
          <p>
            Sourced AI briefs, written theses and a community that recognises the best work. No
            wallet needed to start.
          </p>
        </div>
      </section>
      <section className="auth-panel">
        <div className="s-stack" style={{ gap: 8 }}>
          <span className="s-eyebrow">Welcome</span>
          <h2 style={{ margin: 0, fontSize: 44 }}>Sign in to Suiem</h2>
          <p className="s-muted" style={{ margin: 0 }}>
            New here? Either option creates your account. You can add the other later in Settings.
          </p>
        </div>
        <Card eyebrow="Recommended" title="Passkey">
          <PasskeyLogin onDone={done} />
        </Card>
        <Card title="Wallet" eyebrow="Sign-In With Ethereum">
          <SiweLogin onDone={done} />
        </Card>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <>
      <Suspense>
        <LoginInner />
      </Suspense>
      <Footer />
    </>
  );
}
