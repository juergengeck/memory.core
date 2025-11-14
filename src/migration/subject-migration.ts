/**
 * Subject Migration Utilities
 *
 * Utilities for migrating chat-scoped subjects to global subjects.
 *
 * Old format: `chat-<topicId>-<subject-name>`
 * New format: `subject-<subject-name>` (global, no topicId)
 */

import type { SHA256IdHash } from '../types/one-core-types.js';
import type { SubjectAssembly, SubjectSource } from '../plans/MemoryPlan.js';

export interface MigrationReport {
  totalSubjects: number;
  chatScopedSubjects: number;
  globalSubjects: number;
  duplicatesFound: number;
  merged: Array<{
    oldIds: string[];
    newId: string;
    sourceCount: number;
  }>;
  errors: Array<{
    subjectId: string;
    error: string;
  }>;
}

/**
 * Detect if a subject ID is chat-scoped (old format)
 *
 * @param id Subject ID to check
 * @returns true if chat-scoped, false if global
 */
export function isChatScopedSubjectId(id: string): boolean {
  return id.startsWith('chat-') && id.split('-').length >= 3;
}

/**
 * Extract topicId and name from chat-scoped subject ID
 *
 * @param id Chat-scoped subject ID (e.g., "chat-abc123-project-lama")
 * @returns { topicId, name } or null if invalid format
 */
export function parseChatScopedId(id: string): {
  topicId: string;
  name: string;
} | null {
  if (!isChatScopedSubjectId(id)) {
    return null;
  }

  const parts = id.split('-');
  // Format: chat-<topicId>-<name-parts...>
  const topicId = parts[1];
  const name = parts.slice(2).join('-');

  if (!topicId || !name) {
    return null;
  }

  return { topicId, name };
}

/**
 * Generate global subject ID from name
 *
 * @param name Subject name
 * @returns Global subject ID (e.g., "subject-project-lama")
 */
export function generateGlobalSubjectId(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special chars except hyphen
    .replace(/\s+/g, '-')     // Replace spaces with hyphens
    .replace(/-+/g, '-')      // Collapse multiple hyphens
    .trim();

  return `subject-${normalized}`;
}

/**
 * Convert chat-scoped subject to global format
 *
 * @param subject Subject with chat-scoped ID
 * @returns Subject with global ID and source tracking
 */
export function convertToGlobalSubject(subject: SubjectAssembly): SubjectAssembly {
  const parsed = parseChatScopedId(subject.id);

  if (!parsed) {
    // Already global or invalid format, return as-is
    return subject;
  }

  const { topicId, name } = parsed;
  const globalId = generateGlobalSubjectId(name);

  // Extract confidence from metadata if present
  const confidence = subject.metadata?.get('confidence')
    ? parseFloat(subject.metadata.get('confidence')!)
    : undefined;

  // Create source entry from topicId
  const source: SubjectSource = {
    type: 'chat',
    id: topicId,
    extractedAt: subject.metadata?.get('extractedAt')
      ? parseInt(subject.metadata.get('extractedAt')!)
      : subject.created,
    confidence
  };

  // Create global subject with source tracking
  return {
    ...subject,
    id: globalId,
    sources: [source]
  };
}

/**
 * Merge multiple chat-scoped subjects into a single global subject
 *
 * Combines keywords, descriptions, and sources from all instances.
 *
 * @param subjects Array of subjects with same normalized name
 * @returns Merged global subject
 */
export function mergeSubjects(subjects: SubjectAssembly[]): SubjectAssembly {
  if (subjects.length === 0) {
    throw new Error('Cannot merge empty array of subjects');
  }

  if (subjects.length === 1) {
    return convertToGlobalSubject(subjects[0]);
  }

  // Use first subject as base
  const base = subjects[0];
  const globalId = isChatScopedSubjectId(base.id)
    ? generateGlobalSubjectId(base.name)
    : base.id;

  // Collect all sources
  const sources: SubjectSource[] = [];
  const allKeywords = new Set<string>();
  let mostRecentModified = base.modified || base.created;
  let earliestCreated = base.created;

  // Merge descriptions (prefer longest)
  let mergedDescription = base.description || '';

  for (const subject of subjects) {
    // Extract source from each subject
    const parsed = parseChatScopedId(subject.id);
    if (parsed) {
      const confidence = subject.metadata?.get('confidence')
        ? parseFloat(subject.metadata.get('confidence')!)
        : undefined;

      sources.push({
        type: 'chat',
        id: parsed.topicId,
        extractedAt: subject.metadata?.get('extractedAt')
          ? parseInt(subject.metadata.get('extractedAt')!)
          : subject.created,
        confidence
      });
    }

    // Merge keywords
    if (subject.keywords) {
      for (const keyword of subject.keywords) {
        allKeywords.add(keyword);
      }
    }

    // Merge metadata keywords (legacy)
    const metadataKeywords = subject.metadata?.get('keywords');
    if (metadataKeywords) {
      for (const keyword of metadataKeywords.split(',')) {
        allKeywords.add(keyword.trim());
      }
    }

    // Track timestamps
    if (subject.modified && subject.modified > mostRecentModified) {
      mostRecentModified = subject.modified;
    }
    if (subject.created < earliestCreated) {
      earliestCreated = subject.created;
    }

    // Prefer longest description
    if (subject.description && subject.description.length > mergedDescription.length) {
      mergedDescription = subject.description;
    }
  }

  return {
    $type$: 'SubjectAssembly',
    id: globalId,
    name: base.name,
    description: mergedDescription || undefined,
    keywords: Array.from(allKeywords),
    metadata: base.metadata, // Keep base metadata
    sources,
    created: earliestCreated,
    modified: mostRecentModified
  };
}

/**
 * Group subjects by normalized name for duplicate detection
 *
 * @param subjects Array of subjects
 * @returns Map of normalized name → subjects with that name
 */
export function groupSubjectsByName(
  subjects: SubjectAssembly[]
): Map<string, SubjectAssembly[]> {
  const groups = new Map<string, SubjectAssembly[]>();

  for (const subject of subjects) {
    // Extract name from ID if chat-scoped
    const parsed = parseChatScopedId(subject.id);
    const name = parsed ? parsed.name : subject.name;
    const normalized = name.toLowerCase();

    if (!groups.has(normalized)) {
      groups.set(normalized, []);
    }
    groups.get(normalized)!.push(subject);
  }

  return groups;
}

/**
 * Analyze subjects for migration planning
 *
 * @param subjects Array of all subjects
 * @returns Analysis report
 */
export function analyzeSubjects(subjects: SubjectAssembly[]): {
  total: number;
  chatScoped: number;
  global: number;
  duplicates: Array<{
    name: string;
    count: number;
    ids: string[];
  }>;
} {
  let chatScoped = 0;
  let global = 0;

  for (const subject of subjects) {
    if (isChatScopedSubjectId(subject.id)) {
      chatScoped++;
    } else {
      global++;
    }
  }

  // Find duplicates (same normalized name)
  const groups = groupSubjectsByName(subjects);
  const duplicates: Array<{
    name: string;
    count: number;
    ids: string[];
  }> = [];

  for (const [name, group] of groups) {
    if (group.length > 1) {
      duplicates.push({
        name,
        count: group.length,
        ids: group.map(s => s.id)
      });
    }
  }

  return {
    total: subjects.length,
    chatScoped,
    global,
    duplicates
  };
}

/**
 * Perform dry-run migration (no changes)
 *
 * @param subjects Array of subjects to migrate
 * @returns Migration plan
 */
export function planMigration(subjects: SubjectAssembly[]): MigrationReport {
  const report: MigrationReport = {
    totalSubjects: subjects.length,
    chatScopedSubjects: 0,
    globalSubjects: 0,
    duplicatesFound: 0,
    merged: [],
    errors: []
  };

  const groups = groupSubjectsByName(subjects);

  for (const [name, group] of groups) {
    try {
      const hasMultiple = group.length > 1;
      const hasChatScoped = group.some(s => isChatScopedSubjectId(s.id));

      if (hasChatScoped) {
        report.chatScopedSubjects += group.length;
      } else {
        report.globalSubjects += group.length;
      }

      if (hasMultiple && hasChatScoped) {
        // Found duplicates that need merging
        report.duplicatesFound += group.length;

        const merged = mergeSubjects(group);
        report.merged.push({
          oldIds: group.map(s => s.id),
          newId: merged.id,
          sourceCount: merged.sources?.length || 0
        });
      }
    } catch (error) {
      report.errors.push({
        subjectId: group[0].id,
        error: (error as Error).message
      });
    }
  }

  return report;
}

/**
 * Check if migration is needed
 *
 * @param subjects Array of subjects
 * @returns true if any chat-scoped subjects found
 */
export function needsMigration(subjects: SubjectAssembly[]): boolean {
  return subjects.some(s => isChatScopedSubjectId(s.id));
}
