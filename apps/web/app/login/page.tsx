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
    <main id="main" className="public">
      <Wordmark />
      <h1 style={{ margin: 0 }}>Sign in to Suiem</h1>
      <p className="s-muted" style={{ margin: 0 }}>
        New here? Either option creates your account. You can add the other later in Settings.
      </p>
      <Card title="Passkey">
        <PasskeyLogin onDone={done} />
      </Card>
      <Card title="Wallet (Sign-In With Ethereum)">
        <SiweLogin onDone={done} />
      </Card>
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
