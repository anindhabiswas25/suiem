import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { type PipelineDeps, processRequest } from "./pipeline";

export const RESEARCH_QUEUE = "research";
export interface ResearchJob {
  requestId: string;
}

/** BullMQ needs its own connections (maxRetriesPerRequest: null). */
export function researchQueue(connection: Redis): Queue<ResearchJob> {
  return new Queue<ResearchJob>(RESEARCH_QUEUE, {
    connection,
    defaultJobOptions: { attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
  });
}

export async function enqueueResearch(queue: Queue<ResearchJob>, requestId: string): Promise<void> {
  // jobId = requestId makes enqueueing idempotent.
  await queue.add("brief", { requestId }, { jobId: requestId });
}

export function startResearchWorker(
  connection: Redis,
  deps: PipelineDeps,
  concurrency = 2,
): Worker<ResearchJob> {
  return new Worker<ResearchJob>(
    RESEARCH_QUEUE,
    async (job) => processRequest(deps, job.data.requestId),
    { connection, concurrency },
  );
}
