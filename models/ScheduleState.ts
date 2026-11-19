// models/ScheduleState.ts — per-job scheduler state (consumed by lib/schedule.ts)
import mongoose from "mongoose";

const scheduleStateSchema = new mongoose.Schema(
  {
    job: { type: String, required: true, unique: true, index: true },
    running: { type: Boolean, default: false },
    lastRunAt: { type: Date, default: null },
    lastRunOk: { type: Boolean, default: null },
    notes: { type: String, default: "" },
    // Reserved for cursor-based jobs that need to resume mid-batch across
    // invocations. brief-generator today re-queries "next N approved" so it
    // doesn't use this, but reserving it means we can add cursor-based jobs
    // later without a migration.
    cursor: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

const ScheduleState =
  mongoose.models.ScheduleState ||
  mongoose.model("ScheduleState", scheduleStateSchema);

export default ScheduleState;