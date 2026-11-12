/** Demo seed data. Entities come from @suiem/shared/entities (public reference facts, no market data). */
import { ENTITY_DICTIONARY } from "@suiem/shared/entities";

/** Single source of truth: the shared dictionary (also used by the extension's detector). */
export const SEED_ENTITIES = ENTITY_DICTIONARY;

/**
 * The 5 test Stock Tokens the official faucet hands out (VERIFIED_FACTS T-02). Their contract
 * addresses are UNVERIFIED (T-05), so they stay `unverified` with no address until Sprint 5.
 */
export const TESTNET_STOCK_TOKENS = [
  { entity: "tesla", ticker: "TSLA", symbol: "TEST:TSLA", name: "Tesla test token" },
  { entity: "amazon", ticker: "AMZN", symbol: "TEST:AMZN", name: "Amazon test token" },
  { entity: "palantir", ticker: "PLTR", symbol: "TEST:PLTR", name: "Palantir test token" },
  { entity: "netflix", ticker: "NFLX", symbol: "TEST:NFLX", name: "Netflix test token" },
  { entity: "amd", ticker: "AMD", symbol: "TEST:AMD", name: "AMD test token" },
] as const;

export const DEMO_USERS = [
  {
    handle: "demo_ada",
    displayName: "Ada (demo)",
    interests: ["technology", "ai"],
    jurisdiction: "IN",
  },
  {
    handle: "demo_grace",
    displayName: "Grace (demo)",
    interests: ["healthcare", "finance"],
    jurisdiction: "DE",
  },
  {
    handle: "demo_alan",
    displayName: "Alan (demo)",
    interests: ["energy", "consumer"],
    jurisdiction: "SG",
  },
  {
    handle: "demo_mira",
    displayName: "Mira (demo)",
    interests: ["technology", "consumer"],
    jurisdiction: "GB",
  },
  {
    handle: "demo_kofi",
    displayName: "Kofi (demo)",
    interests: ["finance", "technology"],
    jurisdiction: "GH",
  },
  {
    handle: "demo_lin",
    displayName: "Lin (demo)",
    interests: ["technology", "ai"],
    jurisdiction: "SG",
  },
] as const;

type DemoHandle = (typeof DEMO_USERS)[number]["handle"];

/**
 * Demo creator posts so the feed is not empty on a fresh install. Every author is is_demo
 * (shown with a Demo badge). Content is about research process only: no price targets, no
 * buy/sell calls, no market data.
 */
export const DEMO_POSTS: {
  key: string;
  author: DemoHandle;
  kind: "discussion" | "question" | "learning_note";
  entity?: string;
  sourced?: boolean;
  hoursAgo: number;
  body: string;
  helpfulFrom?: DemoHandle[];
  comments?: { author: DemoHandle; body: string }[];
}[] = [
  {
    key: "ada-nvda-risk",
    author: "demo_ada",
    kind: "discussion",
    entity: "nvidia",
    sourced: true,
    hoursAgo: 0.4,
    body: "Rereading NVIDIA's latest annual report, Item 1A (risk factors). The part I keep coming back to is customer concentration: a small number of large buyers make up a big share of revenue.\n\nWhat would change my mind on my thesis: clear evidence those buyers' in-house chips are shipping at scale.\n\nSource: SEC EDGAR, Form 10-K.",
    helpfulFrom: ["demo_grace", "demo_lin", "demo_kofi"],
    comments: [
      {
        author: "demo_lin",
        body: "Same section caught my eye. I also track how often the word 'export' shows up year over year. Crude, but it shows where management's attention is.",
      },
      {
        author: "demo_mira",
        body: "Do you write the 'what would change my mind' line before or after reading analyst takes?",
      },
    ],
  },
  {
    key: "grace-lly-patents",
    author: "demo_grace",
    kind: "question",
    entity: "eli-lilly",
    hoursAgo: 1.2,
    body: "Question for the healthcare folks: when you read a pharma annual report, how do you weigh patent expiry dates against the pipeline section?\n\nI keep a simple table: product, expiry year, share of revenue. Is there a better habit?",
    helpfulFrom: ["demo_alan"],
    comments: [
      {
        author: "demo_kofi",
        body: "I add a column for 'where did I read this'. Half my mistakes come from mixing up company claims and news summaries.",
      },
    ],
  },
  {
    key: "mira-process",
    author: "demo_mira",
    kind: "learning_note",
    hoursAgo: 2.5,
    body: "My checklist for any new company, before I read a single opinion:\n\n1. Read the business section of the annual report.\n2. Write one sentence on how they make money.\n3. Write what would prove me wrong.\n4. Set a date to come back and check.\n\nStep 3 is the one that saves me.",
    helpfulFrom: ["demo_ada", "demo_grace", "demo_alan", "demo_kofi", "demo_lin"],
    comments: [
      { author: "demo_ada", body: "Stealing step 4. I never set review dates and it shows." },
    ],
  },
  {
    key: "lin-tsmc-segments",
    author: "demo_lin",
    kind: "learning_note",
    entity: "tsmc",
    sourced: true,
    hoursAgo: 4,
    body: "If you research chip designers, read TSMC's annual report too. It breaks revenue down by process node and by platform (smartphone, high-performance computing, and so on).\n\nMany of the companies people talk about here depend on that capacity, so it's useful context.\n\nSource: TSMC investor relations, annual report.",
    helpfulFrom: ["demo_ada"],
  },
  {
    key: "kofi-visa-network",
    author: "demo_kofi",
    kind: "learning_note",
    entity: "visa",
    hoursAgo: 6,
    body: "Something that took me too long to understand: Visa is a payments network, not a lender. Banks issue the cards and carry the credit risk.\n\nOnce that clicked, their income statement made a lot more sense.",
    helpfulFrom: ["demo_grace", "demo_mira"],
    comments: [
      {
        author: "demo_grace",
        body: "Good one. Mastercard works the same way, which makes them a nice pair to compare.",
      },
    ],
  },
  {
    key: "alan-tsla-deliveries",
    author: "demo_alan",
    kind: "learning_note",
    entity: "tesla",
    hoursAgo: 8,
    body: "Learning note: 'deliveries' and 'revenue' are not the same number, and they aren't reported at the same time.\n\nDeliveries come out first. Revenue comes later in the quarterly report. I mixed them up for a while.",
    helpfulFrom: ["demo_mira"],
  },
  {
    key: "ada-election-thanks",
    author: "demo_ada",
    kind: "discussion",
    hoursAgo: 11,
    body: "Thank you to everyone who voted in the first weekly election. Every vote was a $WIF burn on mainnet, so it meant something.\n\nVotes don't change anyone's Suiem Score. They just say 'this research helped me'. That's the kind of signal I want more of.",
    helpfulFrom: ["demo_lin", "demo_kofi"],
  },
  {
    key: "grace-apple-services",
    author: "demo_grace",
    kind: "question",
    entity: "apple",
    hoursAgo: 14,
    body: "Apple reports Products and Services separately. Has anyone compared the gross margin of the two segments across several years? I'd like to see the method before the conclusion.",
    comments: [
      {
        author: "demo_lin",
        body: "The 10-K has both margins in the MD&A section. I'll post my table once I've checked it twice.",
      },
    ],
  },
  {
    key: "lin-amd-question",
    author: "demo_lin",
    kind: "question",
    entity: "amd",
    hoursAgo: 18,
    body: "Practising on testnet with the AMD test token. No real value, but I'm using it to check whether I actually follow my own exit rule.\n\nAnyone else use practice mode this way?",
    helpfulFrom: ["demo_alan", "demo_mira"],
  },
  {
    key: "kofi-jpm-reading",
    author: "demo_kofi",
    kind: "discussion",
    entity: "jpmorgan",
    sourced: true,
    hoursAgo: 23,
    body: "JPMorgan's annual shareholder letter is long, but it's one of the clearest explanations of how a big bank thinks about risk.\n\nI read it with a notebook: one line per risk they name, one line on what they say they do about it.\n\nSource: JPMorgan Chase annual report.",
    helpfulFrom: ["demo_ada", "demo_grace"],
  },
  {
    key: "mira-amzn-segments",
    author: "demo_mira",
    kind: "discussion",
    entity: "amazon",
    hoursAgo: 29,
    body: "Amazon is three businesses in one report: North America, International and AWS. Reading the segment note changed how I think about the company more than any headline did.",
    helpfulFrom: ["demo_kofi"],
  },
  {
    key: "alan-energy-question",
    author: "demo_alan",
    kind: "question",
    hoursAgo: 36,
    body: "Starting to research energy companies. Which filing sections do you read first? I usually start with risk factors, but for energy I suspect the reserves disclosures matter more.",
    comments: [
      {
        author: "demo_grace",
        body: "Reserves first, then capital spending plans. Then risk factors to see what they're worried about.",
      },
    ],
  },
];
