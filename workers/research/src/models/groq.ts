import {
  classifyStatus,
  type Fetcher,
  type GenerateInput,
  ModelError,
  type ResearchModel,
  timedFetch,
} from "./types";

/** Groq OpenAI-compatible chat completions with Structured Outputs (strict: true). */
export class GroqModel implements ResearchModel {
  readonly provider = "groq" as const;
  constructor(
    private readonly apiKey: string | undefined,
    readonly model: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMs = 60_000,
  ) {}

  async generate(input: GenerateInput) {
    if (!this.apiKey) throw new ModelError("groq", "config", "GROQ_API_KEY is not set");
    const res = await timedFetch(
      this.fetcher,
      "groq",
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_completion_tokens: input.maxOutputTokens ?? 3000,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: input.schemaName, strict: true, schema: input.schema },
          },
        }),
      },
      this.timeoutMs,
    );
    if (!res.ok) throw classifyStatus("groq", res.status);
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { total_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new ModelError("groq", "bad_output", "groq returned no content");
    try {
      return { json: JSON.parse(content) as unknown, tokens: body.usage?.total_tokens ?? 0 };
    } catch {
      throw new ModelError("groq", "bad_output", "groq returned invalid JSON");
    }
  }
}
