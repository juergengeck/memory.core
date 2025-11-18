/**
 * Subject Migration Utilities
 *
 * @deprecated This entire file is deprecated - Subjects now use ONE.core automatic ID hashing
 *
 * OLD APPROACH (deprecated):
 * - Manual ID generation via generateGlobalSubjectId()
 * - Chat-scoped IDs like "chat-<topicId>-<subject-name>"
 * - Global IDs like "subject-<subject-name>"
 *
 * NEW APPROACH (current):
 * - ONE.core automatically generates SHA256IdHash<Subject> from keywords
 * - Keywords are marked isId: true in SubjectRecipe
 * - Subjects with same keywords get same ID hash (automatic deduplication)
 * - No manual ID generation needed
 *
 * See: lama.core/one-ai/models/Subject.ts - createOrUpdateSubject()
 */

import type { SHA256IdHash } from '../types/one-core-types.js';
import type { Subject } from '../../../lama.core/one-ai/types/Subject.js';
import type { SubjectSource } from '../plans/MemoryPlan.js';

/**
 * @deprecated Legacy migration code - no longer needed with ONE.core automatic ID hashing
 */
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
 * @deprecated Subjects no longer use manual IDs - ONE.core generates from keywords
 */
export function isChatScopedSubjectId(id: string): boolean {
  return id.startsWith('chat-') && id.split('-').length >= 3;
}

/**
 * @deprecated Subjects no longer use manual IDs - ONE.core generates from keywords
 */
export function parseChatScopedId(id: string): {
  topicId: string;
  name: string;
} | null {
  if (!isChatScopedSubjectId(id)) {
    return null;
  }

  const parts = id.split('-');
  const topicId = parts[1];
  const name = parts.slice(2).join('-');

  if (!topicId || !name) {
    return null;
  }

  return { topicId, name };
}

/**
 * @deprecated ONE.core automatically generates ID hash from keywords - no manual IDs needed
 *
 * Use createOrUpdateSubject() instead which uses ONE.core automatic ID hashing
 */
export function generateGlobalSubjectId(name: string): string {
  console.warn('[DEPRECATED] generateGlobalSubjectId is deprecated - use ONE.core automatic ID hashing');
  const normalized = name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  return `subject-${normalized}`;
}

/**
 * Convert chat-scoped subject to global format
 *
 * @param subject Subject with chat-scoped ID
 * @returns Subject with global ID and source tracking
 */
export function convertToGlobalSubject(subject: Subject): Subject {
  const parsed = parseChatScopedId(subject.id);

  if (!parsed) {
    // Already global or invalid format, return as-is
    return subject;
  }

  const { topicId, name } = parsed;
  const globalId = generateGlobalSubjectId(name);

  // Create source entry from topicId
  const source: SubjectSource = {
    type: 'chat',
    id: topicId,
    extractedAt: subject.createdAt || Date.now(),
    confidence: undefined  // Confidence is no longer stored in metadata
  };

  // Create global subject with source tracking
  return {
    ...subject,
    id: globalId,
    sources: [source],
    description: subject.description || name  // Use description or fallback to name from ID
  };
}

/**
 * Merge multiple chat-scoped subjects into a single global subject
 *
 * Combines keywords, descriptions, and sources from all instances.
 *
 * @param subjects Array of subjects with same normalized name
 * @returns Merged global subject
 *
 * @deprecated Legacy migration code - disabled due to schema changes
 */
export function mergeSubjects(subjects: Subject[]): Subject {
  if (subjects.length === 0) {
    throw new Error('Cannot merge empty array of subjects');
  }

  if (subjects.length === 1) {
    return convertToGlobalSubject(subjects[0]);
  }

  // TODO: Fix for new Subject schema (no name, no metadata, no created/modified fields)
  throw new Error('mergeSubjects is deprecated and needs refactoring for new Subject schema');

  /* Legacy code commented out - needs refactoring
  // Use first subject as base
  const base = subjects[0];
  const globalId = isChatScopedSubjectId(base.id)
    ? generateGlobalSubjectId(base.description || base.id)
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
    $type$: 'Subject',
    id: globalId,
    name: base.name,
    description: mergedDescription || undefined,
    keywords: Array.from(allKeywords),
    metadata: base.metadata, // Keep base metadata
    sources,
    created: earliestCreated,
    modified: mostRecentModified
  };
  */
}

/**
 * Group subjects by normalized name for duplicate detection
 *
 * @param subjects Array of subjects
 * @returns Map of normalized name → subjects with that name
 *
 * @deprecated Legacy migration code - disabled due to schema changes
 */
export function groupSubjectsByName(
  subjects: Subject[]
): Map<string, Subject[]> {
  throw new Error('groupSubjectsByName is deprecated and needs refactoring for new Subject schema');

  /* Legacy code commented out
  const groups = new Map<string, Subject[]>();

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
  */
}

/**
 * Analyze subjects for migration planning
 *
 * @param subjects Array of all subjects
 * @returns Analysis report
 *
 * @deprecated Legacy migration code - disabled due to schema changes
 */
export function analyzeSubjects(subjects: Subject[]): {
  total: number;
  chatScoped: number;
  global: number;
  duplicates: Array<{
    name: string;
    count: number;
    ids: string[];
  }>;
} {
  throw new Error('analyzeSubjects is deprecated and needs refactoring for new Subject schema');
}

/**
 * Perform dry-run migration (no changes)
 *
 * @param subjects Array of subjects to migrate
 * @returns Migration plan
 *
 * @deprecated Legacy migration code - disabled due to schema changes
 */
export function planMigration(subjects: Subject[]): MigrationReport {
  throw new Error('planMigration is deprecated and needs refactoring for new Subject schema');

  /* Legacy code commented out
export function planMigration_OLD(subjects: Subject[]): MigrationReport {
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
  */
}

/**
 * Check if migration is needed
 *
 * @param subjects Array of subjects
 * @returns true if any chat-scoped subjects found
 */
export function needsMigration(subjects: Subject[]): boolean {
  return subjects.some(s => isChatScopedSubjectId(s.id));
}
