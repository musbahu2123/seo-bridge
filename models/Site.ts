// models/Site.ts — a tenant: one per SaaS we manage
import mongoose from "mongoose";

const siteSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // "ResumeTailorApp"
    domain: { type: String, required: true, unique: true }, // "resumetailorapp.com"

    // ── Google Search Console ──
    gscSiteUrl: { type: String, default: null }, // "sc-domain:resumetailorapp.com" or "https://www...."
    gscRefreshToken: { type: String, default: null }, // AES-GCM encrypted via lib/crypto
    gscConnectedAt: { type: Date, default: null },

    // ── Sources ──
    sitemapUrl: { type: String, required: true },
    competitors: { type: [String], default: [] }, // ["zety.com","tealhq.com",...]

    // ── Strategy context (injected into every LLM prompt) ──
    positioning: { type: String, default: "" }, // "The resume tool that gets you interviews"
    buyerPrompts: { type: [String], default: [] }, // AI-citation prospecting prompts (brief 11.3)

    // ── Publishing (into the SaaS's existing admin blog API) ──
    publishUrl: { type: String, required: true }, // https://www.resumetailorapp.com/api/admin/blog
    publishKey: { type: String, required: true }, // ApiKey the SaaS admin created — AES-GCM encrypted

    // ── Bridge topic -> target BlogPost category mapping ──
    categoryMap: {
      type: Map,
      of: String,
      default: {
        interview: "Career Advice",
        negotiation: "Career Advice",
        career: "Career Advice",
        "resume-mechanics": "ATS Optimization",
        tool: "AI Tools",
        template: "Templates",
      },
    },

    ctaPages: { type: [String], default: [] }, // ["/ats-resume-checker","/ai-resume-builder",...]
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const Site = mongoose.models.Site || mongoose.model("Site", siteSchema);
export default Site;