// models/ArticleJob.ts — brief -> draft -> human review -> pushed to the SaaS
import mongoose from "mongoose";

// Sub-schema for a single SEO check (mirrors lib/seoValidate.ts SeoCheck)
const seoCheckSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, default: "" },
    status: { type: String, enum: ["pass", "fail", "warn"], default: "warn" },
    detail: { type: String, default: "" },
  },
  { _id: false },
);

// Full validation result persisted on the job so the review UI can render it
// without re-running the validator.
const seoValidationSchema = new mongoose.Schema(
  {
    pass: { type: Boolean, default: true },
    hardFails: { type: [String], default: [] }, // check keys with status="fail"
    warnings: { type: [String], default: [] },  // check keys with status="warn"
    checks: { type: [seoCheckSchema], default: [] },
    validatedAt: { type: Date, default: null },
    // Human override: if true, the publisher will allow pushing even when
    // pass=false. Only settable via an explicit "Force publish" action.
    forceOverride: { type: Boolean, default: false },
    forceOverrideBy: { type: String, default: "" },
    forceOverrideAt: { type: Date, default: null },
  },
  { _id: false },
);

const articleJobSchema = new mongoose.Schema(
  {
    keywordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Keyword",
      required: true,
    },
    site: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: true,
      index: true,
    },

    // ── LLM outputs ──
    brief: { type: String, default: "" },
    outline: { type: [String], default: [] },
    ctaPlan: { type: String, default: "" },
    draft: { type: String, default: "" },
    faqs: {
      type: [{ q: String, a: String }],
      default: [],
    },

    // ── SEO fields for the target BlogPost ──
    title: { type: String, default: "" },
    slug: { type: String, default: "" },
    description: { type: String, default: "" },
    metaTitle: { type: String, default: "" },
    metaDescription: { type: String, default: "" },
    category: { type: String, default: "" },
    readTime: { type: String, default: "6 min" },
    image: { type: String, default: "/images/blog/default.jpg" },

    // ── YouTube transcript as RAG context (human-provided) ──
    youtubeUrl: { type: String, default: "" },
    youtubeTranscript: { type: String, default: "" },

    // ── SEO formula validation (R4, Batch 4) ──
    // Populated by brief-generator after the LLM returns. Persisted so the
    // review UI shows the checklist and the publisher can refuse on pass=false
    // unless forceOverride=true.
    seoValidation: { type: seoValidationSchema, default: () => ({}) },

    // ── Landing-page flag (R3, Batch 4) ──
    // If the keyword is landing-shaped, brief-generator creates a LandingTodo
    // and marks this job as "flagged_for_landing" with a reason. The publisher
    // refuses to push unless a human clears it.
    landingFlag: {
      flagged: { type: Boolean, default: false },
      reason: { type: String, default: "" },
      landingTodoId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "LandingTodo",
        default: null,
      },
    },

    // ── Pipeline state ──
    status: {
      type: String,
      enum: ["awaiting_review", "approved", "pushed", "rejected"],
      default: "awaiting_review",
      index: true,
    },
    reviewedBy: { type: String, default: "" },
    reviewNotes: { type: String, default: "" },

    // ── Push log ──
    postId: { type: String, default: "" },
    publishedUrl: { type: String, default: "" },
    pushedAt: { type: Date, default: null },
    indexNowPinged: { type: Boolean, default: false },
    bingSubmittedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const ArticleJob =
  mongoose.models.ArticleJob || mongoose.model("ArticleJob", articleJobSchema);
export default ArticleJob;