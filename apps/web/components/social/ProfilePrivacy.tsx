"use client";
import { PRIVACY_FIELDS, VISIBILITIES, type PrivacyKey } from "@suiem/shared/social";
import { Button, Card, ErrorState, LoadingState, Status } from "@suiem/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiRequestError } from "../../lib/api";

type Visibility = (typeof VISIBILITIES)[number];
type Privacy = Record<PrivacyKey, Visibility> & { appearInLeaderboards: boolean };
type MyProfile = {
  handle: string;
  displayName: string | null;
  bio: string | null;
  handleChangeAvailable: boolean;
  privacy: Privacy;
};

const LABEL: Record<Visibility, string> = {
  private: "Only me",
  followers: "Followers",
  public: "Everyone",
};

/** Public profile (handle, bio) and per-field privacy, backed by GET/PATCH /me/profile. */
export function ProfilePrivacy() {
  const qc = useQueryClient();
  const q = useQuery<MyProfile>({
    queryKey: ["my-profile"],
    queryFn: () => api("GET", "/me/profile"),
  });
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "positive" | "negative"; text: string } | null>(null);

  useEffect(() => {
    if (q.data) {
      setHandle(q.data.handle);
      setBio(q.data.bio ?? "");
      setPrivacy(q.data.privacy);
    }
  }, [q.data]);

  if (q.isPending || !privacy) return <LoadingState label="Loading your profile…" />;
  if (q.isError)
    return <ErrorState message="Could not load your profile." retry={() => void q.refetch()} />;

  const current = q.data;
  const walletGoingPublic =
    privacy.walletVisibility !== "private" && current.privacy.walletVisibility === "private";

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const changed = Object.fromEntries(
        Object.entries(privacy).filter(([k, v]) => current.privacy[k as keyof Privacy] !== v),
      );
      await api("PATCH", "/me/profile", {
        ...changed,
        ...(handle !== current.handle ? { handle } : {}),
        ...(bio.trim() !== (current.bio ?? "")
          ? { bio: bio.trim() === "" ? null : bio.trim() }
          : {}),
        ...(walletGoingPublic && ack ? { acknowledgeOnchainPublicity: true } : {}),
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["my-profile"] }),
        qc.invalidateQueries({ queryKey: ["me"] }),
      ]);
      setAck(false);
      setMsg({ tone: "positive", text: "Public profile saved." });
    } catch (e) {
      setMsg({
        tone: "negative",
        text:
          e instanceof ApiRequestError || e instanceof Error
            ? e.message.split("\n")[0]!
            : "Something went wrong",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Public profile & privacy">
      <div id="privacy" className="s-stack">
        <label className="s-field">
          <span>Handle</span>
          <input
            className="s-input"
            value={handle}
            maxLength={24}
            disabled={!current.handleChangeAvailable}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
          />
          <span className="s-small s-muted">
            {current.handleChangeAvailable
              ? "3–24 lowercase letters, numbers or underscores. You can change it once."
              : "You have already changed your handle."}
          </span>
        </label>
        <label className="s-field">
          <span>Bio</span>
          <textarea
            className="s-input"
            rows={3}
            maxLength={500}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="What you research and how you invest."
          />
        </label>

        <span className="s-small s-muted">
          Everything is private by default. Choose who can see each part of your profile.
        </span>
        <ul className="s-stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {PRIVACY_FIELDS.map((f) => (
            <li
              key={f.key}
              className="s-row"
              style={{ justifyContent: "space-between", alignItems: "flex-start" }}
            >
              <div className="grow" style={{ minWidth: 200 }}>
                <div style={{ fontWeight: 600 }}>{f.label}</div>
                <div className="s-small s-muted">{f.help}</div>
              </div>
              <select
                className="s-select"
                aria-label={f.label}
                value={privacy[f.key]}
                onChange={(e) => setPrivacy({ ...privacy, [f.key]: e.target.value as Visibility })}
              >
                {VISIBILITIES.map((v) => (
                  <option key={v} value={v}>
                    {LABEL[v]}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>

        {walletGoingPublic ? (
          <label className="s-row" style={{ alignItems: "flex-start" }}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span className="s-small">
              I understand that showing my wallet address links my Suiem profile to every onchain
              transaction it has ever made, including $WIF votes.
            </span>
          </label>
        ) : null}

        <label className="s-row" style={{ alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={privacy.appearInLeaderboards}
            onChange={(e) => setPrivacy({ ...privacy, appearInLeaderboards: e.target.checked })}
          />
          <span>
            <strong>Appear in leaderboards</strong>
            <span className="s-small s-muted" style={{ display: "block" }}>
              Required to be nominated in community elections. Your Suiem Score is shown next to
              your handle.
            </span>
          </span>
        </label>

        <div className="s-row">
          <Button
            variant="primary"
            loading={busy}
            disabled={walletGoingPublic && !ack}
            onClick={() => void save()}
          >
            Save public profile
          </Button>
        </div>
        {msg ? <Status tone={msg.tone}>{msg.text}</Status> : null}
      </div>
    </Card>
  );
}
