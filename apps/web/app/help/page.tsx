import { Card, DISCLAIMER, NetworkBadge, Wordmark } from "@suiem/ui";
import Link from "next/link";
import { Footer } from "../../components/AppShell";

export const metadata = { title: "Help & disclosures · Suiem" };

export default function Help() {
  return (
    <>
      <main id="main" className="public">
        <Wordmark />
        <h1 style={{ margin: 0 }}>Help &amp; disclosures</h1>

        <Card title="Who we are">
          <p style={{ margin: 0 }}>
            <strong>{DISCLAIMER}</strong> Suiem is an independent project built for the World is
            Flat hackathon on Robinhood Chain. We do not use Robinhood's name or logo for our brand.
          </p>
        </Card>

        <Card title="Not investment advice">
          <p style={{ margin: 0 }}>
            Suiem provides educational research tools. Nothing on Suiem is a recommendation to buy
            or sell anything. AI-generated research can be wrong or out of date, so always check the
            cited sources. Past performance, scores and elections say nothing about future returns.
          </p>
        </Card>

        <Card title="AI research: providers and data">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>
              <strong>AI models (free tiers):</strong> Groq (<code>openai/gpt-oss-120b</code>)
              writes briefs; Google Gemini (Flash) is the fallback when Groq is busy or a draft
              fails our checks. Each brief says which model wrote it and when.
            </li>
            <li>
              <strong>Google Gemini free tier:</strong> Google may use content sent on its free tier
              to improve its products. Suiem therefore sends only public data (filings, market data,
              news), plus text you highlighted <em>only if you ticked</em> "include selected text"
              in the extension's preview.
            </li>
            <li>
              <strong>Data:</strong> SEC EDGAR (company filings and XBRL financial facts) and{" "}
              <strong>Finnhub (free tier)</strong> for quotes, company profile, peers, valuation
              metrics and news. Finnhub's free plan is for non-commercial use.
            </li>
            <li>
              <strong>What the AI does and doesn't do:</strong> financial figures are computed by
              Suiem's code from filings, never by the AI. Every AI claim must cite a retrieved
              source; claims with numbers not found in the sources are removed; certainty or
              buy/sell language is rejected. Missing data is shown as missing.
            </li>
            <li>
              Briefs from public data only may be shared between users for up to 12 hours to save
              free-tier quota (labelled with their generation time). Briefs that used your
              highlighted text are never shared or reused.
            </li>
            <li>
              AI research can still be wrong. Check the cited sources. It is never investment
              advice.
            </li>
          </ul>
        </Card>

        <Card title="Networks and what's real">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>
              <NetworkBadge network="testnet" />: the Stock Token demo runs on Robinhood Chain
              testnet (46630). Testnet tokens have <strong>no value</strong>, are{" "}
              <strong>not securities</strong> and are <strong>not shares</strong>. They are for
              practice only.
            </li>
            <li>
              <NetworkBadge network="mainnet" />: community elections use real <strong>$WIF</strong>{" "}
              on Robinhood Chain mainnet (4663). Voting <strong>burns</strong> the $WIF you vote
              with. Burns are permanent and cannot be refunded.
            </li>
            <li>
              <strong>$WIF carries no promise of value or return.</strong> Suiem does not issue $WIF
              and makes no claim about its price. Rewards, if any, are prefunded and disclosed in
              advance; they never come from $WIF price.
            </li>
            <li>Your Suiem Score is never affected by $WIF holdings or votes.</li>
            <li>
              Suiem never buys, sells or votes for you. Every onchain action needs your explicit
              signature in your own wallet.
            </li>
          </ul>
        </Card>

        <Card title="Where Stock Token features are unavailable">
          <p style={{ margin: 0 }}>
            Stock Token features are blocked for users in the United States, Canada, the United
            Kingdom, Switzerland, Cuba, Belarus, Iran, North Korea, Russia, Syria, Ukraine, South
            Sudan, Sudan, Myanmar and Venezuela, and for anyone who has not declared a country. See{" "}
            <a href="https://docs.robinhood.com/rhj/restricted-jurisdictions" rel="noreferrer">
              the restricted jurisdictions list
            </a>
            .
          </p>
        </Card>

        <Card title="Terms of Service (draft 2026-11-10.1)">
          <div id="terms" className="s-muted">
            Draft for the hackathon demo, pending legal review. Suiem runs research and demo
            features; testnet assets have no value; you keep custody of your wallet; you may close
            your account and request deletion of your data at any time.
          </div>
        </Card>

        <Card title="Privacy Notice (draft 2026-11-10.1)">
          <div id="privacy" className="s-muted">
            We store only what we need: a handle, passkey public keys, preferences, consent records
            and, if you link one, a public wallet address. No private keys, no seed phrases, no raw
            browsing history, nothing personal onchain. Logs are redacted. You can export or delete
            your data from Settings.
          </div>
        </Card>

        <Card title="Optional consents">
          <div id="consents" className="s-muted">
            Product analytics and product news are optional and off unless you turn them on.
            Extension detection and digest sync arrive with the extension.
          </div>
        </Card>

        <p>
          <Link href="/">Back to Suiem</Link>
        </p>
      </main>
      <Footer />
    </>
  );
}
