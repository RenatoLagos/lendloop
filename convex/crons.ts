import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
// Re-drive failed Convex -> n8n notifications (bounded attempts, see automation.ts).
crons.interval("retry failed notifications", { minutes: 15 }, internal.automation.retryFailed, {});
export default crons;
