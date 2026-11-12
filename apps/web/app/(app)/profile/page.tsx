"use client";
import { LoadingState } from "@suiem/ui";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "../../../lib/session";

/** Your profile lives at its public address. */
export default function Profile() {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me.data) router.replace(`/u/${me.data.handle}`);
  }, [me.data, router]);
  return <LoadingState label="Opening your profile…" />;
}
