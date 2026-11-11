import {
  classifyStatus,
  type Fetcher,
  type GenerateInput,
  ModelError,
  type ResearchModel,
  timedFetch,
} from "./types";

/** Converts our strict JSON Schema to Gemini's OpenAPI-subset `responseSchema`. */
export function toGeminiSchema(s: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const type = s.type as string | undefined;
  if (type) out.type = type.toUpperCase();
  if (s.enum) out.enum = s.enum;
  if (s.description) out.description = s.description;
  if (s.properties) {
    const props = s.properties as Record<string, Record<string, unknown>>;
    out.properties = Object.fromEntries(
      Object.entries(props).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
    out.required = s.required ?? Object.keys(props);
    out.propertyOrdering = Object.keys(props);
  }
  if (s.items) out.items = toGeminiSchema(s.items as Record<string, unknown>);
  return out;
}

/**
 * Google Gemini generateContent with JSON output. FREE-TIER NOTE: Google may use free-tier
 * content to improve its products, so only public data (plus a user excerpt the user explicitly
 * ticked) is ever sent. Disclosed in Help and in the research request preview.
 */
export class GeminiModel implements ResearchModel {
  readonly provider = "gemini" as const;
  constructor(
    private readonly apiKey: string | undefined,
    readonly model: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMs = 90_000,
  ) {}

  async generate(input: GenerateInput) {
    if (!this.apiKey) throw new ModelError("gemini", "config", "GEMINI_API_KEY is not set");
    const res = await timedFetch(
      this.fetcher,
      "gemini",
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": this.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: "user", parts: [{ text: input.user }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: input.maxOutputTokens ?? 4000,
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(input.schema),
          },
        }),
      },
      this.timeoutMs,
    );
    if (!res.ok) throw classifyStatus("gemini", res.status);
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { totalTokenCount?: number };
    };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text)
      throw new ModelError(
        "gemini",
        "bad_output",
        `gemini returned no content (${body.candidates?.[0]?.finishReason ?? "none"})`,
      );
    try {
      return {
        json: JSON.parse(text) as unknown,
        tokens: body.usageMetadata?.totalTokenCount ?? 0,
      };
    } catch {
      throw new ModelError("gemini", "bad_output", "gemini returned invalid JSON");
    }
  }
}
