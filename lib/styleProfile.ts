// lib/styleProfile.ts — learn a tenant's writing voice
//
// Split into two halves so callers can compose them:
//
//   computeMetrics(posts)       — JS-only, free, all posts, instant
//   analyzeVoiceLLM(samples)    — LLM, 30 sampled posts, ~$0.01
//
// The caller (style-learn job) is responsible for:
//   - fetching posts from ContentIndex + BlogPost API (need full content)
//   - sampling: top-3 by GSC clicks for anchors + 30 random for LLM analysis
//   - merging metrics + LLM into a StyleProfile doc, versioned, one active
//
// Pure in the computeMetrics half; LLM in the other.
import { llmComplete, parseJsonLoose } from "@/lib/llm";


// Type-safe shape mirroring the model (avoids importing mongoose model here)
export type VoiceSpec = {
  tone: string;
  pov: "first-person" | "second-person" | "mixed" | "";
  sentenceLengthAvg: number;
  sentenceLengthRange: number[];
  paragraphLengthAvg: number;
  headingStyle: string;
  openingPatterns: string[];
  closingPatterns: string[];
  recurringPhrases: string[];
  bannedPhrasings: string[];
  usesLists: boolean;
  usesTables: boolean;
  avgWordCount: number;
  emDashUsage: "never" | "rare" | "frequent" | "";
};

export type FewShotAnchor = {
  title: string;
  url: string;
  excerpt: string;
};

export type PostForStyle = {
  title: string;
  url: string;
  content: string; // full HTML
};

// ── JS metrics (pure) ──

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitParagraphs(html: string): string[] {
  const matches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) ?? [];
  return matches.map((m) => stripHtml(m)).filter((s) => s.length > 0);
}

// Frequency helper for n-grams at the start of first paragraphs / sentences
function topStarts(starts: string[], n = 5): string[] {
  const counts = new Map<string, number>();
  for (const s of starts) {
    const key = s.toLowerCase().split(/\s+/).slice(0, 3).join(" ").trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

export function computeMetrics(posts: PostForStyle[]): VoiceSpec {
  if (posts.length === 0) {
    return {
      tone: "",
      pov: "",
      sentenceLengthAvg: 0,
      sentenceLengthRange: [0, 0],
      paragraphLengthAvg: 0,
      headingStyle: "",
      openingPatterns: [],
      closingPatterns: [],
      recurringPhrases: [],
      bannedPhrasings: [],
      usesLists: false,
      usesTables: false,
      avgWordCount: 0,
      emDashUsage: "",
    };
  }

  let totalWords = 0;
  let totalSentences = 0;
  let totalParagraphs = 0;
  let emDashCount = 0;
  let listBlocks = 0;
  let tableBlocks = 0;
  let headingCount = 0;
  const sentenceLens: number[] = [];
  const openingStarts: string[] = [];
  const closingStarts: string[] = [];

  for (const p of posts) {
    const text = stripHtml(p.content);
    const sentences = splitSentences(text);
    const paragraphs = splitParagraphs(p.content);
    const words = text.split(/\s+/).filter(Boolean);

    totalWords += words.length;
    totalSentences += sentences.length;
    totalParagraphs += paragraphs.length;
    emDashCount += (p.content.match(/—/g) || []).length;
    listBlocks += (p.content.match(/<(ul|ol)[\s>]/gi) || []).length;
    tableBlocks += (p.content.match(/<table[\s>]/gi) || []).length;
    headingCount += (p.content.match(/<h[23][\s>]/gi) || []).length;

    for (const s of sentences) {
      const wc = s.split(/\s+/).filter(Boolean).length;
      if (wc > 0) sentenceLens.push(wc);
    }

    if (paragraphs.length > 0) {
      openingStarts.push(paragraphs[0]);
      closingStarts.push(paragraphs[paragraphs.length - 1]);
    }
  }

  sentenceLens.sort((a, b) => a - b);
  const sentenceLengthAvg =
    totalSentences > 0 ? sentenceLens.reduce((a, b) => a + b, 0) / totalSentences : 0;
  const sentenceLengthRange: number[] = [
    sentenceLens.length > 0 ? sentenceLens[0] : 0,
    sentenceLens.length > 0 ? sentenceLens[sentenceLens.length - 1] : 0,
  ];

  const paragraphLengthAvg =
    totalParagraphs > 0 ? totalSentences / totalParagraphs : 0;
  const avgWordCount = posts.length > 0 ? totalWords / posts.length : 0;

  // POV detection
  const text = posts.map((p) => stripHtml(p.content)).join(" ");
  const iCount = (text.match(/\bI\b/g) || []).length;
  const weCount = (text.match(/\bwe\b/gi) || []).length;
  const youCount = (text.match(/\byou\b/gi) || []).length;
  let pov: VoiceSpec["pov"] = "";
  if (iCount + weCount > youCount * 1.5) pov = "first-person";
  else if (youCount > iCount + weCount) pov = "second-person";
  else if (iCount + weCount + youCount > 0) pov = "mixed";

  // Em dash frequency
  const emDashPerHundred = totalWords > 0 ? (emDashCount / totalWords) * 100 : 0;
  let emDashUsage: VoiceSpec["emDashUsage"] = "never";
  if (emDashPerHundred > 1) emDashUsage = "frequent";
  else if (emDashPerHundred > 0.1) emDashUsage = "rare";

  // Heading style heuristic: count question-mark H2/H3 vs action-verb H2/H3
  const headingTexts: string[] = [];
  for (const p of posts) {
    const m = p.content.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi) ?? [];
    for (const h of m) headingTexts.push(stripHtml(h));
  }
  const questions = headingTexts.filter((h) => /\?$/.test(h)).length;
  const verbs = headingTexts.filter((h) =>
    /^(how|why|what|when|get|build|make|start|stop|avoid|find|use|master)/i.test(h),
  ).length;
  const headingStyle =
    questions > headingTexts.length * 0.4
      ? "questions"
      : verbs > headingTexts.length * 0.4
        ? "action verbs"
        : "mixed";

  return {
    tone: "", // filled by LLM
    pov,
    sentenceLengthAvg: Math.round(sentenceLengthAvg * 10) / 10,
    sentenceLengthRange,
    paragraphLengthAvg: Math.round(paragraphLengthAvg * 10) / 10,
    headingStyle,
    openingPatterns: topStarts(openingStarts, 5),
    closingPatterns: topStarts(closingStarts, 3),
    recurringPhrases: [], // filled by LLM
    bannedPhrasings: [],  // filled by LLM
    usesLists: listBlocks / posts.length >= 0.5,
    usesTables: tableBlocks / posts.length >= 0.2,
    avgWordCount: Math.round(avgWordCount),
    emDashUsage,
  };
}

// ── LLM voice analysis ──

const SYSTEM_PROMPT = `You are a writing-voice analyst. Given 20-30 excerpts from the SAME author/tenant, describe the voice so another writer can imitate it.

# Rules
- Be concrete. "Confident" is bad; "Confident and direct, uses second person, avoids hedges like 'may' and 'could'" is good.
- recurringPhrases: 3-6 short phrases that repeat (taglines, self-identifiers, refrains). Empty array if none.
- bannedPhrasings: 3-6 phrases this voice would NOT use — typically AI clichés this writer clearly avoids ("let's dive in", "in today's fast-paced world", "game-changer"). Base this on absence in the samples.
- openingPatterns / closingPatterns: 2-3 concrete patterns (e.g. "opens with a one-sentence contrast", "closes with a bold prompt to act").

# Output
Return ONLY valid JSON. No markdown. No preamble. Schema:
{
  "tone": "string (one sentence)",
  "pov": "first-person|second-person|mixed",
  "recurringPhrases": ["..."],
  "bannedPhrasings": ["..."],
  "openingPatterns": ["..."],
  "closingPatterns": ["..."]
}`;

export async function analyzeVoiceLLM(
  samples: PostForStyle[],
): Promise<{
  tone: string;
  pov: "first-person" | "second-person" | "mixed";
  recurringPhrases: string[];
  bannedPhrasings: string[];
  openingPatterns: string[];
  closingPatterns: string[];
} | { error: string }> {
  if (samples.length === 0) {
    return { error: "no samples to analyze" };
  }

  // Trim each sample to ~800 words to stay well inside token budget.
  const trimmed = samples.slice(0, 30).map((p, i) => {
    const text = stripHtml(p.content);
    const words = text.split(/\s+/).filter(Boolean).slice(0, 800).join(" ");
    return `## Sample ${i + 1}: ${p.title}
${words}
`;
  });

  const userPrompt = `# Voice samples from ONE tenant (${trimmed.length} posts)

${trimmed.join("\n---\n")}

Analyze the shared voice. Return JSON only.`;

  let raw: string;
  try {
    raw = await llmComplete({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 2000,
      temperature: 0.3,
      jsonMode: true,
    });
  } catch (e) {
    return { error: `LLM failed: ${String((e as Error)?.message ?? e)}` };
  }

  try {
    const parsed = parseJsonLoose<{
      tone?: string;
      pov?: string;
      recurringPhrases?: string[];
      bannedPhrasings?: string[];
      openingPatterns?: string[];
      closingPatterns?: string[];
    }>(raw);

    const povOk =
      parsed.pov === "first-person" ||
      parsed.pov === "second-person" ||
      parsed.pov === "mixed"
        ? parsed.pov
        : "mixed";

    return {
      tone: String(parsed.tone ?? "").trim(),
      pov: povOk,
      recurringPhrases: Array.isArray(parsed.recurringPhrases)
        ? parsed.recurringPhrases.map(String).slice(0, 6)
        : [],
      bannedPhrasings: Array.isArray(parsed.bannedPhrasings)
        ? parsed.bannedPhrasings.map(String).slice(0, 6)
        : [],
      openingPatterns: Array.isArray(parsed.openingPatterns)
        ? parsed.openingPatterns.map(String).slice(0, 3)
        : [],
      closingPatterns: Array.isArray(parsed.closingPatterns)
        ? parsed.closingPatterns.map(String).slice(0, 3)
        : [],
    };
  } catch (e) {
    return { error: `JSON parse failed: ${String((e as Error)?.message ?? e)}` };
  }
}

// ── Merge ──

export function mergeVoiceSpec(
  jsMetrics: VoiceSpec,
  llmAnalysis: Awaited<ReturnType<typeof analyzeVoiceLLM>>,
): VoiceSpec {
  if ("error" in llmAnalysis) return jsMetrics;
  return {
    ...jsMetrics,
    tone: llmAnalysis.tone || jsMetrics.tone,
    pov: llmAnalysis.pov || jsMetrics.pov,
    recurringPhrases: llmAnalysis.recurringPhrases,
    bannedPhrasings: llmAnalysis.bannedPhrasings,
    // Prefer LLM if it returned 2+, else keep JS-derived starts
    openingPatterns:
      llmAnalysis.openingPatterns.length >= 2
        ? llmAnalysis.openingPatterns
        : jsMetrics.openingPatterns,
    closingPatterns:
      llmAnalysis.closingPatterns.length >= 2
        ? llmAnalysis.closingPatterns
        : jsMetrics.closingPatterns,
  };
}

// ── Prompt renderer ──

/**
 * Renders a compact, token-cheap voice block for the brief-generator prompt.
 * ~150-200 tokens. Safe to inline into SYSTEM_PROMPT or append to user prompt.
 */
export function renderVoiceBlock(
  spec: VoiceSpec,
  anchors: FewShotAnchor[],
): string {
  const lines: string[] = [];
  lines.push("# Tenant voice (learned from published posts)");
  if (spec.tone) lines.push(`Tone: ${spec.tone}`);
  if (spec.pov) lines.push(`POV: ${spec.pov}`);
  if (spec.sentenceLengthAvg) {
    lines.push(
      `Sentence length: avg ${spec.sentenceLengthAvg} words (range ${spec.sentenceLengthRange[0]}-${spec.sentenceLengthRange[1]})`,
    );
  }
  if (spec.paragraphLengthAvg) {
    lines.push(`Paragraphs: avg ${spec.paragraphLengthAvg} sentences`);
  }
  if (spec.headingStyle) lines.push(`Headings: ${spec.headingStyle}`);
  if (spec.openingPatterns.length) {
    lines.push(`Open with patterns like: ${spec.openingPatterns.slice(0, 2).join("; ")}`);
  }
  if (spec.closingPatterns.length) {
    lines.push(`Close with patterns like: ${spec.closingPatterns.slice(0, 2).join("; ")}`);
  }
  if (spec.recurringPhrases.length) {
    lines.push(`Recurring phrases: ${spec.recurringPhrases.slice(0, 4).join(", ")}`);
  }
  if (spec.bannedPhrasings.length) {
    lines.push(`NEVER use: ${spec.bannedPhrasings.join(", ")}`);
  }
  if (spec.usesTables) lines.push("Uses comparison tables when relevant");
  if (spec.emDashUsage) lines.push(`Em dash usage: ${spec.emDashUsage}`);

  if (anchors.length > 0) {
    lines.push("");
    lines.push("# Canonical voice anchors (match this voice)");
    anchors.forEach((a, i) => {
      lines.push(`## ${i + 1}. "${a.title}" (${a.url})`);
      lines.push(a.excerpt);
      lines.push("");
    });
  }

  return lines.join("\n");
}