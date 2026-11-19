// lib/llm.ts — DeepSeek (latest V4.1 Flash) preferred, Anthropic fallback, OpenAI last.
//
// IMPORTANT: The legacy aliases "deepseek-chat" and "deepseek-reasoner" were RETIRED
// on 2026-07-24. Current canonical models:
//   - deepseek-flash   → DeepSeek-V4.1-Flash-1017  (default, ~$0.14/$0.28 per 1M tokens)
//   - deepseek-v4-pro  → DeepSeek-V4-Pro-0813      (optional, higher quality, thinking mode)
//
// Base URL: https://api.deepseek.com (OpenAI-compatible wire format)
// Auth: Bearer DEEPSEEK_API_KEY
// Docs: https://api-docs.deepseek.com

export type LlmProvider = "deepseek" | "anthropic" | "openai";

const DEEPSEEK_BASE = "https://api.deepseek.com";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-flash";
const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const OPENAI_MODEL = "gpt-4o";

export function getProvider(): LlmProvider {
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  throw new Error(
    "No LLM key set. Set DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY in .env.local",
  );
}

export type LlmCallOptions = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
};

export async function llmComplete(opts: LlmCallOptions): Promise<string> {
  const provider = getProvider();
  if (provider === "deepseek") return deepseekComplete(opts);
  if (provider === "anthropic") return anthropicComplete(opts);
  return openaiComplete(opts);
}

async function deepseekComplete(o: LlmCallOptions): Promise<string> {
  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: o.temperature ?? 0.7,
      messages: [
        { role: "system", content: o.system },
        { role: "user", content: o.user },
      ],
      max_tokens: o.maxTokens ?? 8000,
      ...(o.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`DeepSeek failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("DeepSeek returned no text");
  return text;
}

async function anthropicComplete(o: LlmCallOptions): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: o.maxTokens ?? 8000,
      temperature: o.temperature ?? 0.7,
      system: o.system,
      messages: [{ role: "user", content: o.user }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`Anthropic failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const text = json.content.find((c) => c.type === "text")?.text ?? "";
  if (!text) throw new Error("Anthropic returned no text");
  return text;
}

async function openaiComplete(o: LlmCallOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model: OPENAI_MODEL,
    temperature: o.temperature ?? 0.7,
    messages: [
      { role: "system", content: o.system },
      { role: "user", content: o.user },
    ],
    max_tokens: o.maxTokens ?? 8000,
  };
  if (o.jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`OpenAI failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("OpenAI returned no text");
  return text;
}

export function parseJsonLoose<T>(raw: string): T {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s) as T;
}