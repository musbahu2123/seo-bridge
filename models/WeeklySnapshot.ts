// models/WeeklySnapshot.ts — the Monday report card (gsc-sync + linkreview write here)
import mongoose from "mongoose";

const weeklySnapshotSchema = new mongoose.Schema(
  {
    site: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: true,
      index: true,
    },
    week: { type: Date, required: true }, // the Monday of the reported week

    // ── GSC 28d vs previous 28d ──
    clicks: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 },
    avgPosition: { type: Number, default: 0 },
    newQueries: { type: [String], default: [] },
    lostQueries: { type: [String], default: [] },

    // ── Linkreview additions (brief 11.5) ──
    referringDomains: { type: Number, default: 0 },
    linksReceivedLive: { type: Number, default: 0 },
    newCitedDomains: { type: [String], default: [] }, // from AI-citation prospecting (11.3)

    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

weeklySnapshotSchema.index({ site: 1, week: 1 }, { unique: true });

const WeeklySnapshot =
  mongoose.models.WeeklySnapshot ||
  mongoose.model("WeeklySnapshot", weeklySnapshotSchema);
export default WeeklySnapshot;