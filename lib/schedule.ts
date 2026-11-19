// lib/schedule.ts — lazy-trigger scheduler
//
// CRITICAL: every job route MUST call markJobFinished(name, ok, note) before returning.
// The scheduler only unblocks "running" on HTTP failure. A job that forgets leaves
// running:true forever and is never due again.
import dbConnect from "@/lib/dbConnect";
import ScheduleState from "@/models/ScheduleState";

export type JobName =
  | "gsc-sync"
  | "content-sync"
  | "keyword-harvest"
  | "brief-generator"
  | "publisher"
  | "index-monitor"
  | "bing-submit"
  | "linkreview";

type JobDef = {
  name: JobName;
  path: string;
  cadenceHours: number;
  query?: Record<string, string>;
};

const JOBS: JobDef[] = [
  { name: "content-sync", path: "/api/jobs/content-sync", cadenceHours: 6 * 24 },
  { name: "gsc-sync", path: "/api/jobs/gsc-sync", cadenceHours: 6 * 24 },
  {
    name: "keyword-harvest",
    path: "/api/jobs/keyword-harvest",
    cadenceHours: 6 * 24,
    query: { limit: "10" },
  },
  {
    name: "brief-generator",
    path: "/api/jobs/brief-generator",
    cadenceHours: 24,
    query: { limit: "2" },
  },
  {
    name: "publisher",
    path: "/api/jobs/publisher",
    cadenceHours: 24,
    query: { limit: "5" },
  },
  { name: "index-monitor", path: "/api/jobs/index-monitor", cadenceHours: 24 },
  { name: "bing-submit", path: "/api/jobs/bing-submit", cadenceHours: 24 },
  { name: "linkreview", path: "/api/jobs/linkreview", cadenceHours: 6 * 24 },
];

function baseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function isDue(def: JobDef): Promise<boolean> {
  const state = await ScheduleState.findOne({ job: def.name }).lean();
  if (!state) return true;
  if (state.running) return false;
  if (!state.lastRunAt) return true;
  const hours =
    (Date.now() - new Date(state.lastRunAt).getTime()) / (1000 * 60 * 60);
  return hours >= def.cadenceHours;
}

async function markRunning(name: JobName) {
  await ScheduleState.findOneAndUpdate(
    { job: name },
    { $set: { running: true } },
    { upsert: true },
  );
}

export function maybeRunDueJobs(): void {
  void runDueJobs().catch((err) => {
    console.warn("[schedule] runDueJobs failed:", err);
  });
}

async function runDueJobs() {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[schedule] CRON_SECRET not set, skipping");
    return;
  }
  await dbConnect();

  const checks = await Promise.all(
    JOBS.map(async (def) => ({ def, due: await isDue(def) })),
  );

  for (const { def, due } of checks) {
    if (!due) continue;
    await markRunning(def.name);

    const params = new URLSearchParams(def.query ?? {});
    const url = `${baseUrl()}${def.path}?${params.toString()}`;

    fetch(url, { headers: { "x-cron-secret": secret } })
      .then((res) => {
        if (!res.ok) {
          return ScheduleState.findOneAndUpdate(
            { job: def.name },
            {
              $set: {
                running: false,
                lastRunAt: new Date(),
                lastRunOk: false,
                notes: `HTTP ${res.status}`,
              },
            },
          );
        }
      })
      .catch((err) => {
        void ScheduleState.findOneAndUpdate(
          { job: def.name },
          {
            $set: {
              running: false,
              lastRunAt: new Date(),
              lastRunOk: false,
              notes: String(err).slice(0, 200),
            },
          },
        );
      });
  }
}

export async function markJobFinished(
  name: JobName,
  ok: boolean,
  note = "",
): Promise<void> {
  await ScheduleState.findOneAndUpdate(
    { job: name },
    {
      $set: {
        running: false,
        lastRunAt: new Date(),
        lastRunOk: ok,
        notes: note.slice(0, 200),
      },
    },
    { upsert: true },
  );
}

export async function scheduleContinuation(
  name: JobName,
  extraQuery: Record<string, string> = {},
): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const def = JOBS.find((j) => j.name === name);
  if (!def) return;

  const params = new URLSearchParams({ ...(def.query ?? {}), ...extraQuery });
  const url = `${baseUrl()}${def.path}?${params.toString()}`;

  fetch(url, { headers: { "x-cron-secret": secret } }).catch(() => {});
}