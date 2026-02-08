/**
 * Parallel Exploration - Fan-out page exploration across route groups.
 *
 * Groups routes by path prefix and assigns each group to a separate
 * Claude subagent job. All jobs share the BrowserQueue for serialized
 * browser access.
 *
 * @module phases/parallel-exploration
 */

import fs from 'node:fs';
import { getPageDir } from '../artifact-paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParallelExplorationConfig {
  auditDir: string;
  baseUrl: string;
  routes: string[];
  maxPages: number;
  promptPath: string;
  concurrency: number;
}

export interface RouteGroup {
  prefix: string;
  routes: string[];
}

export interface ParallelExplorationResult {
  groupsCreated: number;
  totalPagesVisited: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Run parallel exploration using JobRunner.
 *
 * @param config - Parallel exploration configuration.
 * @param jobRunner - JobRunner's runJobs function.
 * @param createExploreJob - Factory to create a job for each route group.
 * @returns Exploration results.
 */
export async function runParallelExploration(
  config: ParallelExplorationConfig,
  jobRunner: (
    jobs: Array<{ id: string; name: string; execute: () => Promise<unknown>; requiresBrowser: boolean }>,
    options: { concurrency: number; timeout: number; maxRetries: number; retryBackoff: 'exponential' | 'linear' },
  ) => Promise<Array<{ jobId: string; status: string; output?: unknown; error?: string }>>,
  createExploreJob: (group: RouteGroup, index: number) => () => Promise<unknown>,
): Promise<ParallelExplorationResult> {
  const result: ParallelExplorationResult = {
    groupsCreated: 0,
    totalPagesVisited: 0,
    errors: [],
  };

  // Group routes by prefix
  const groups = groupRoutesByPrefix(config.routes.slice(0, config.maxPages));
  result.groupsCreated = groups.length;

  console.log(
    `[ParallelExploration] ${groups.length} route group(s), concurrency: ${config.concurrency}`,
  );

  // Create jobs for each group
  const jobs = groups.map((group, i) => ({
    id: `explore-group-${i}`,
    name: `Explore ${group.prefix}* (${group.routes.length} routes)`,
    execute: createExploreJob(group, i),
    requiresBrowser: true,
  }));

  // Run through JobRunner
  const jobResults = await jobRunner(jobs, {
    concurrency: config.concurrency,
    timeout: 300_000, // 5 min per group
    maxRetries: 2,
    retryBackoff: 'exponential',
  });

  // Collect results
  for (const jr of jobResults) {
    if (jr.status === 'completed') {
      // Count pages from this group
    } else if (jr.error) {
      result.errors.push(`${jr.jobId}: ${jr.error}`);
    }
  }

  // Count total pages written
  const pageDir = getPageDir(config.auditDir);
  if (fs.existsSync(pageDir)) {
    result.totalPagesVisited = fs.readdirSync(pageDir)
      .filter(f => f.endsWith('.json')).length;
  }

  console.log(
    `[ParallelExploration] Complete: ${result.totalPagesVisited} pages across ${result.groupsCreated} groups.`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Group routes by their first path segment.
 *
 * Example: ['/admin/users', '/admin/settings', '/api/v1'] →
 *   [{prefix: '/admin', routes: ['/admin/users', '/admin/settings']},
 *    {prefix: '/api', routes: ['/api/v1']}]
 */
export function groupRoutesByPrefix(routes: string[]): RouteGroup[] {
  const groups = new Map<string, string[]>();

  for (const route of routes) {
    const segments = route.split('/').filter(Boolean);
    const prefix = segments.length > 0 ? `/${segments[0]}` : '/';

    if (!groups.has(prefix)) {
      groups.set(prefix, []);
    }
    groups.get(prefix)!.push(route);
  }

  return [...groups.entries()].map(([prefix, groupRoutes]) => ({
    prefix,
    routes: groupRoutes,
  }));
}
