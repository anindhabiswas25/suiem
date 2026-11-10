import { detect, notifiable } from "@suiem/shared/entities";
import { E2E } from "../core/config";
import toastCss from "../ui/toast.css?inline";

/**
 * Detector content script. Registered at RUNTIME only on sites the user granted, and only while
 * Suiem is ON (see core/gate.ts); there is no static content script in the manifest.
 * It reads visible text locally, runs the detector, and sends the worker hashed detections only
 * (never page text). It has no path to any API, wallet or order: it can only message the worker.
 */
export default defineContentScript({
  registration: "runtime",
  main() {
    const w = window as unknown as { __suiemDetector?: boolean };
    if (w.__suiemDetector) return;
    w.__suiemDetector = true;

    let stopped = false;
    let threshold = 0.8;
    const sent = new Set<string>();
    let host: HTMLElement | null = null;
    let timer: number | undefined;

    const send = <T>(msg: unknown): Promise<T | undefined> =>
      chrome.runtime.sendMessage(msg).catch(() => undefined) as Promise<T | undefined>;

    function visibleText(): string {
      const nodes = document.querySelectorAll<HTMLElement>(
        '[data-testid="tweetText"], article, p, h1, h2, h3, li, blockquote',
      );
      const parts: string[] = [];
      let total = 0;
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight || r.width === 0) continue;
        const t = el.innerText?.trim();
        if (!t) continue;
        parts.push(t);
        total += t.length;
        if (total > 20_000) break;
      }
      return parts.join("\n");
    }

    function removeToast() {
      host?.remove();
      host = null;
    }

    function toast(info: { entityId: string; name: string; tickers: string[]; why: string }) {
      removeToast();
      host = document.createElement("suiem-toast");
      host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483646;";
      // Closed shadow root: the page cannot read or script the toast. E2E builds open it for Playwright.
      const root = host.attachShadow({ mode: E2E ? "open" : "closed" });
      const style = document.createElement("style");
      style.textContent = toastCss;
      const box = document.createElement("div");
      box.className = "toast";
      box.setAttribute("role", "status");
      box.setAttribute("aria-live", "polite");
      const title = document.createElement("strong");
      title.textContent = `${info.name} detected`;
      const sub = document.createElement("span");
      sub.className = "sub";
      sub.textContent = `${info.tickers.join(" · ")}. ${info.why}`;
      const row = document.createElement("div");
      row.className = "row";
      const button = (label: string, onClick: () => void, primary = false) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        if (primary) b.className = "primary";
        b.addEventListener("click", onClick);
        row.append(b);
      };
      const act = (action: "research" | "save" | "mute-entity" | "mute-site") => {
        void send({ type: "toast", action, entityId: info.entityId });
        removeToast();
      };
      button("Research", () => act("research"), true);
      button("Save for later", () => act("save"));
      // Dismiss records no intent: it sends nothing at all.
      button("Dismiss", removeToast);
      button(`Mute ${info.name}`, () => act("mute-entity"));
      button("Mute site", () => act("mute-site"));
      const brand = document.createElement("span");
      brand.className = "brand";
      brand.textContent = "Suiem · nothing is bought or sent automatically";
      box.append(title, sub, row, brand);
      root.append(style, box);
      document.documentElement.append(host);
      window.setTimeout(removeToast, 20_000);
    }

    async function scan() {
      if (stopped) return;
      const detections = notifiable(
        detect(visibleText(), { domain: location.hostname }),
        threshold,
      );
      for (const d of detections) {
        if (sent.has(d.entityId) || stopped) continue;
        sent.add(d.entityId);
        const r = await send<{
          notify: boolean;
          entityId: string;
          name: string;
          tickers: string[];
          why: string;
        }>({ type: "detection", detection: d });
        if (r?.notify) {
          toast(r);
          break;
        }
      }
    }

    const schedule = () => {
      if (stopped) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void scan(), 800);
    };
    const observer = new MutationObserver(schedule);

    function stop() {
      stopped = true;
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.clearTimeout(timer);
      removeToast();
    }

    chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
      if (msg?.type === "stop") stop();
    });

    void (async () => {
      const hello = await send<{ active: boolean; threshold: number }>({ type: "cs-hello" });
      if (!hello?.active) return stop();
      threshold = hello.threshold;
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      window.addEventListener("scroll", schedule, { passive: true });
      void scan();
    })();
  },
});
