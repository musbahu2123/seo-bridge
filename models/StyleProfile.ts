// models/StyleProfile.ts — learned writing voice for a tenant
// Purpose: inject a compact voice spec + 2-3 canonical excerpts into every
//          brief-generator prompt, so drafts match the tenant's existing voice
//          instead of reading like generic LLM output.
//
// VERSIONED: every run creates a new version. Exactly one is isActive=true per
// site (enforced by partial unique index below). Previous versions are kept so
// you can rollback or A/B later.
import mongoose from "mongoose";

const anchorSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    url: { type: String, required: true },
    // ~200-word excerpt + one representative body paragraph, chosen so the
    // LLM can imitate the voice without consuming the whole post.
    excerpt: { type: String, required: true },
  },
  { _id: false },
);

const voiceSpecSchema = new mongoose.Schema(
  {
    tone: { type: String, default: "" },           // "confident, direct, experience-driven"
    pov: {
      type: String,
      enum: ["first-person", "second-person", "mixed", ""],
      default: "",
    },
    sentenceLengthAvg: { type: Number, default: 0 },
    sentenceLengthRange: { type: [Number], default: [0, 0] }, // [min, max]
    paragraphLengthAvg: { type: Number, default: 0 },          // sentences per paragraph
    headingStyle: { type: String, default: "" },               // "action verbs" | "questions" | "mixed"
    openingPatterns: { type: [String], default: [] },          // how first paragraphs start
    closingPatterns: { type: [String], default: [] },          // how posts end
    recurringPhrases: { type: [String], default: [] },
    bannedPhrasings: { type: [String], default: [] },          // "let's dive in", "in today's world"
    usesLists: { type: Boolean, default: false },
    usesTables: { type: Boolean, default: false },
    avgWordCount: { type: Number, default: 0 },
    emDashUsage: {
      type: String,
      enum: ["never", "rare", "frequent", ""],
      default: "",
    },
  },
  { _id: false },
);

const styleProfileSchema = new mongoose.Schema(
  {
    site: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: true,
      index: true,
    },
    version: { type: Number, required: true }, // 1, 2, 3...
    isActive: { type: Boolean, default: false, index: true },

    voiceSpec: { type: voiceSpecSchema, default: () => ({}) },
    fewShotAnchors: { type: [anchorSchema], default: [] },

    // ── Provenance ──
    learnedFrom: { type: Number, default: 0 },       // total posts in ContentIndex at learn time
    sampledForLLM: { type: Number, default: 0 },     // how many were sent to the LLM
    llmModel: { type: String, default: "" },
    refreshedAt: { type: Date, default: Date.now },

    notes: { type: String, default: "" }, // free-form human note
  },
  { timestamps: true },
);

// Version uniqueness per site
styleProfileSchema.index({ site: 1, version: 1 }, { unique: true });

// Only ONE active profile per site — enforced at DB level, not application level.
// partialFilterExpression means the unique constraint only applies to docs where
// isActive === true. Multiple isActive:false versions coexist fine.
styleProfileSchema.index(
  { site: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

const StyleProfile =
  mongoose.models.StyleProfile ||
  mongoose.model("StyleProfile", styleProfileSchema);

export default StyleProfile;