/** Local pages that imitate X posts. Served on http://localhost:<port> during E2E. */
const post = (title: string, author: string, text: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: system-ui; max-width: 600px; margin: 40px auto">
  <main>
    <article data-testid="tweet">
      <div><strong>${author}</strong> <span>@${author.toLowerCase().replace(/\s+/g, "")}</span></div>
      <div data-testid="tweetText" lang="en"><p id="post-text">${text}</p></div>
    </article>
  </main>
</body></html>`;

export const FIXTURES: Record<string, string> = {
  "nvda.html": post(
    "Post / X",
    "Market Watcher",
    "$NVDA earnings beat expectations again. Nvidia CEO Jensen Huang says data center demand is still accelerating.",
  ),
  "nvda-again.html": post(
    "Post / X",
    "Another Account",
    "Still thinking about the $NVDA quarter and Nvidia guidance.",
  ),
  "apple-pie.html": post(
    "Post / X",
    "Home Baker",
    "Apple pie recipe with cinnamon and brown sugar. Picked apples at the orchard today!",
  ),
  "tesla.html": post(
    "Post / X",
    "EV Fan",
    "Tesla shares jumped after the robotaxi event; $TSLA up 6% premarket.",
  ),
  "palantir.html": post(
    "Post / X",
    "Gov Tech",
    "Palantir stock rallied after another government contract win. $PLTR",
  ),
  "amd.html": post(
    "Post / X",
    "Chip Talk",
    "Advanced Micro Devices unveiled a new accelerator; AMD shares moved higher.",
  ),
  "netflix.html": post(
    "Post / X",
    "Streaming Daily",
    "Netflix earnings: subscriber growth surprised analysts. $NFLX",
  ),
};
