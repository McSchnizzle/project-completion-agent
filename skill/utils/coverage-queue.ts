/**
 * Coverage Queue - Persistent URL Queue Management
 * Task 6.10: Coverage Queue Persistence
 *
 * Manages the queue of URLs to visit during exploration,
 * with persistence for resumability and priority ordering.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface QueuedUrl {
  url: string;
  route_id: string;
  priority: number;
  depth: number;
  source: 'discovery' | 'sitemap' | 'code-scan' | 'manual';
  discovered_at: string;
  parent_url: string | null;
  metadata: Record<string, unknown>;
}

export interface QueueState {
  schema_version: string;
  audit_id: string;
  updated_at: string;
  pending: QueuedUrl[];
  visited: string[];
  skipped: string[];
  failed: string[];
  stats: QueueStats;
}

export interface QueueStats {
  total_discovered: number;
  total_visited: number;
  total_skipped: number;
  total_failed: number;
  unique_routes: number;
}

const SCHEMA_VERSION = '1.0.0';
const QUEUE_FILENAME = 'coverage-queue.json';

/**
 * Coverage Queue Manager - handles URL queue persistence and operations
 */
export class CoverageQueue {
  private state: QueueState;
  private auditPath: string;
  private routesSeen: Set<string> = new Set();
  private maxQueueSize: number;
  private maxDepth: number;

  constructor(
    auditPath: string,
    auditId: string,
    options: { maxQueueSize?: number; maxDepth?: number } = {}
  ) {
    this.auditPath = auditPath;
    this.maxQueueSize = options.maxQueueSize || 1000;
    this.maxDepth = options.maxDepth || 5;

    // Try to load existing state or create new
    const existingState = this.loadState();

    if (existingState) {
      this.state = existingState;
      // Rebuild routesSeen set
      for (const item of this.state.pending) {
        this.routesSeen.add(item.route_id);
      }
      for (const url of this.state.visited) {
        // Visited URLs don't need route tracking
      }
    } else {
      this.state = this.createInitialState(auditId);
    }
  }

  /**
   * Create initial queue state
   */
  private createInitialState(auditId: string): QueueState {
    return {
      schema_version: SCHEMA_VERSION,
      audit_id: auditId,
      updated_at: new Date().toISOString(),
      pending: [],
      visited: [],
      skipped: [],
      failed: [],
      stats: {
        total_discovered: 0,
        total_visited: 0,
        total_skipped: 0,
        total_failed: 0,
        unique_routes: 0
      }
    };
  }

  /**
   * Load state from disk
   */
  private loadState(): QueueState | null {
    const filePath = path.join(this.auditPath, QUEUE_FILENAME);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data) as QueueState;
    } catch (error) {
      console.error('Failed to load coverage queue:', error);
      return null;
    }
  }

  /**
   * Save state to disk
   */
  save(): void {
    this.state.updated_at = new Date().toISOString();
    this.state.stats = this.calculateStats();

    const filePath = path.join(this.auditPath, QUEUE_FILENAME);
    fs.writeFileSync(filePath, JSON.stringify(this.state, null, 2));
  }

  /**
   * Calculate queue statistics
   */
  private calculateStats(): QueueStats {
    return {
      total_discovered: this.state.pending.length +
                        this.state.visited.length +
                        this.state.skipped.length +
                        this.state.failed.length,
      total_visited: this.state.visited.length,
      total_skipped: this.state.skipped.length,
      total_failed: this.state.failed.length,
      unique_routes: this.routesSeen.size
    };
  }

  /**
   * Add a URL to the queue
   */
  enqueue(
    url: string,
    routeId: string,
    options: {
      priority?: number;
      depth?: number;
      source?: QueuedUrl['source'];
      parentUrl?: string | null;
      metadata?: Record<string, unknown>;
    } = {}
  ): boolean {
    // Check if already visited or in queue
    if (this.state.visited.includes(url) ||
        this.state.skipped.includes(url) ||
        this.state.pending.some(q => q.url === url)) {
      return false;
    }

    // Check depth limit
    const depth = options.depth || 0;
    if (depth > this.maxDepth) {
      this.state.skipped.push(url);
      return false;
    }

    // Check queue size limit
    if (this.state.pending.length >= this.maxQueueSize) {
      // Remove lowest priority item if new item has higher priority
      const lowestPriority = Math.min(...this.state.pending.map(q => q.priority));
      const newPriority = options.priority || 0;

      if (newPriority > lowestPriority) {
        const indexToRemove = this.state.pending.findIndex(q => q.priority === lowestPriority);
        this.state.pending.splice(indexToRemove, 1);
      } else {
        return false;
      }
    }

    const queuedUrl: QueuedUrl = {
      url,
      route_id: routeId,
      priority: options.priority || 0,
      depth,
      source: options.source || 'discovery',
      discovered_at: new Date().toISOString(),
      parent_url: options.parentUrl || null,
      metadata: options.metadata || {}
    };

    // Insert in priority order (higher priority first)
    const insertIndex = this.state.pending.findIndex(q => q.priority < queuedUrl.priority);
    if (insertIndex === -1) {
      this.state.pending.push(queuedUrl);
    } else {
      this.state.pending.splice(insertIndex, 0, queuedUrl);
    }

    this.routesSeen.add(routeId);
    return true;
  }

  /**
   * Get next URL to visit
   */
  dequeue(): QueuedUrl | null {
    if (this.state.pending.length === 0) {
      return null;
    }

    return this.state.pending.shift() || null;
  }

  /**
   * Peek at next URL without removing
   */
  peek(): QueuedUrl | null {
    return this.state.pending[0] || null;
  }

  /**
   * Mark URL as visited
   */
  markVisited(url: string): void {
    if (!this.state.visited.includes(url)) {
      this.state.visited.push(url);
    }
  }

  /**
   * Mark URL as skipped (won't be visited)
   */
  markSkipped(url: string): void {
    if (!this.state.skipped.includes(url)) {
      this.state.skipped.push(url);
    }
    // Remove from pending if present
    const index = this.state.pending.findIndex(q => q.url === url);
    if (index !== -1) {
      this.state.pending.splice(index, 1);
    }
  }

  /**
   * Mark URL as failed
   */
  markFailed(url: string): void {
    if (!this.state.failed.includes(url)) {
      this.state.failed.push(url);
    }
    // Remove from pending if present
    const index = this.state.pending.findIndex(q => q.url === url);
    if (index !== -1) {
      this.state.pending.splice(index, 1);
    }
  }

  /**
   * Check if URL has been visited
   */
  hasVisited(url: string): boolean {
    return this.state.visited.includes(url);
  }

  /**
   * Check if route has been seen
   */
  hasSeenRoute(routeId: string): boolean {
    return this.routesSeen.has(routeId);
  }

  /**
   * Get queue length
   */
  get length(): number {
    return this.state.pending.length;
  }

  /**
   * Check if queue is empty
   */
  get isEmpty(): boolean {
    return this.state.pending.length === 0;
  }

  /**
   * Get all pending URLs
   */
  getPending(): QueuedUrl[] {
    return [...this.state.pending];
  }

  /**
   * Get all visited URLs
   */
  getVisited(): string[] {
    return [...this.state.visited];
  }

  /**
   * Get current position in queue (for resume point)
   */
  getPosition(): number {
    return this.state.visited.length;
  }

  /**
   * Get statistics
   */
  getStats(): QueueStats {
    return this.calculateStats();
  }

  /**
   * Clear the queue (for fresh start)
   */
  clear(): void {
    this.state.pending = [];
    this.routesSeen.clear();
    // Keep visited/skipped/failed for history
  }

  /**
   * Reset entire state (for complete restart)
   */
  reset(auditId: string): void {
    this.state = this.createInitialState(auditId);
    this.routesSeen.clear();
    this.save();
  }

  /**
   * Bulk add URLs with priority
   */
  bulkEnqueue(
    urls: Array<{
      url: string;
      routeId: string;
      priority?: number;
      source?: QueuedUrl['source'];
    }>,
    baseDepth: number = 0
  ): number {
    let added = 0;

    for (const item of urls) {
      if (this.enqueue(item.url, item.routeId, {
        priority: item.priority,
        depth: baseDepth,
        source: item.source
      })) {
        added++;
      }
    }

    return added;
  }

  /**
   * Re-prioritize a URL in the queue
   */
  reprioritize(url: string, newPriority: number): boolean {
    const index = this.state.pending.findIndex(q => q.url === url);
    if (index === -1) return false;

    const item = this.state.pending.splice(index, 1)[0];
    item.priority = newPriority;

    // Re-insert in priority order
    const insertIndex = this.state.pending.findIndex(q => q.priority < newPriority);
    if (insertIndex === -1) {
      this.state.pending.push(item);
    } else {
      this.state.pending.splice(insertIndex, 0, item);
    }

    return true;
  }

  /**
   * Export state for debugging/analysis
   */
  toJSON(): QueueState {
    return {
      ...this.state,
      stats: this.calculateStats()
    };
  }

  /**
   * Static method to load queue from audit path
   */
  static load(auditPath: string): CoverageQueue | null {
    const filePath = path.join(auditPath, QUEUE_FILENAME);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      const state = JSON.parse(data) as QueueState;
      return new CoverageQueue(auditPath, state.audit_id);
    } catch {
      return null;
    }
  }
}
