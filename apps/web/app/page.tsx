import { Card, NetworkBadge, Wordmark } from "@suiem/ui";
import Link from "next/link";
import { Footer } from "../components/AppShell";

export default function Landing() {
  return (
    <>
      <main id="main" className="public">
        <Wordmark />
        <h1 style={{ margin: 0, fontSize: 36 }}>Research before you invest.</h1>
        <p className="s-muted" style={{ margin: 0, fontSize: 18 }}>
          Suiem turns the companies you come across into sourced research, saves your reasoning as
          theses, and lets the community recognise the best contributors in weekly $WIF elections.
        </p>
        <div className="s-row">
          <Link className="s-btn" data-variant="primary" href="/login">
            Get started
          </Link>
          <Link className="s-btn" href="/help">
            How it works &amp; risks
          </Link>
        </div>
        <div className="grid2">
          <Card title="Research first">
            Sourced AI research, watchlists and theses. No wallet needed to start.
          </Card>
          <Card title="Practice safely">
            <span>
              Stock Token demo on <NetworkBadge network="testnet" />. Test tokens are not
              securities. Not available in restricted jurisdictions.
            </span>
          </Card>
          <Card title="Community elections">
            <span>
              Vote for weekly research contributors by burning $WIF on{" "}
              <NetworkBadge network="mainnet" />. Votes never change anyone's Suiem Score.
            </span>
          </Card>
        </div>
      </main>
      <Footer />
    </>
  );
}
