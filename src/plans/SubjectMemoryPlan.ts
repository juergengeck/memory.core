/**
 * Memory Plan
 * Platform-agnostic plan for memory storage operations
 */

import type { SHA256IdHash } from '../types/one-core-types.js';
import type { Subject, SubjectSource } from '../../../lama.core/one-ai/types/Subject.js';
import type { Keyword } from '../../../lama.core/one-ai/types/Keyword.js';
import { SubjectIndex, createIndexEntry, type SubjectMatch } from '../services/SubjectIndex.js';
import {
  generateGlobalSubjectId,
  isChatScopedSubjectId,
  parseChatScopedId,
  convertToGlobalSubject
} from '../migration/subject-migration.js';
import { keywordsToHashes } from '../../../lama.core/one-ai/models/Keyword.js';

// Re-export SubjectSource for migration code
export type { SubjectSource };

export interface CreateSubjectParams {
  id: string;
  description: string;              // Use description instead of name (matches Subject schema)
  keywords?: string[];              // Will be converted to SHA256IdHash<Keyword>[]
  sources?: SubjectSource[];        // Source tracking
  sign?: boolean;
  theme?: 'light' | 'dark' | 'auto';
}

export interface UpdateSubjectParams {
  description?: string;             // Use description instead of name
  keywords?: string[];              // Will be converted to SHA256IdHash<Keyword>[]
  sign?: boolean;
  theme?: 'light' | 'dark' | 'auto';
}

export interface StoreAssemblyResult {
  hash: string;
  idHash: string;
  filePath: string;
}

// SubjectSource moved to @lama/core/one-ai/types/Subject.ts
// Subject is now the canonical type - no more SubjectAssembly duplication!

/**
 * Subject Memory Plan
 *
 * Global memory storage and retrieval (chat-agnostic)
 * Provides platform-agnostic interface for MCP tools
 *
 * Phase 2 Enhancements:
 * - SubjectIndex for fast keyword lookups
 * - Global subject IDs (no topicId prefix)
 * - Source tracking for multi-chat subjects
 * - Backward compatible with chat-scoped IDs
 *
 * NOTE: This manages Subject objects. For Memory document operations, see MemoryPlan.
 */
export class SubjectMemoryPlan {
  private index: SubjectIndex;
  private indexInitialized: boolean = false;
  private subjectCache: Map<string, Subject> = new Map(); // idHash -> subject

  constructor(
    private subjectPlan: any,
    private topicAnalysisModel?: any,
    private channelManager?: any
  ) {
    this.index = new SubjectIndex();
    // Index will be built lazily on first search or explicitly via buildIndex()
  }

  /**
   * Build/rebuild the subject index from all stored subjects
   * Should be called during initialization for best performance
   */
  async buildIndex(): Promise<void> {
    if (!this.subjectPlan) {
      console.warn('[SubjectMemoryPlan] Cannot build index: subjectPlan not initialized');
      return;
    }

    try {
      const subjectIds = await this.listSubjects();
      const subjects: Subject[] = [];

      for (const idHash of subjectIds) {
        const subject = await this.getSubject(idHash);
        if (subject) {
          subjects.push(subject);
        }
      }

      // Build index from all subjects
      const entries = subjects.map(s => createIndexEntry({
        idHash: s.id as SHA256IdHash<any>,
        name: s.description || s.id,  // Use description as name for indexing
        keywords: s.keywords,
        metadata: undefined           // metadata is now stored as Supply objects
      }));

      this.index.buildFromSubjects(entries);
      this.indexInitialized = true;

      console.log(`[SubjectMemoryPlan] Index built with ${subjects.length} subjects`);
    } catch (error) {
      console.error('[SubjectMemoryPlan] Error building index:', error);
      throw error;
    }
  }

  /**
   * Ensure index is built (lazy initialization)
   */
  private async ensureIndex(): Promise<void> {
    if (!this.indexInitialized) {
      await this.buildIndex();
    }
  }

  /**
   * Create a new subject assembly
   *
   * Phase 2: Enhanced with global ID support and source tracking
   *
   * Behavior:
   * - If params.id is chat-scoped (old format), converts to global ID
   * - If subject already exists with global ID, adds source instead of creating duplicate
   * - Updates SubjectIndex automatically
   */
  async createSubject(params: CreateSubjectParams): Promise<StoreAssemblyResult> {
    // Convert chat-scoped ID to global ID if needed
    let globalId = params.id;
    let sources = params.sources || [];

    if (isChatScopedSubjectId(params.id)) {
      const parsed = parseChatScopedId(params.id);
      if (parsed) {
        globalId = generateGlobalSubjectId(parsed.name);

        // Extract source from chat-scoped ID
        if (sources.length === 0) {
          sources = [{
            type: 'chat',
            id: parsed.topicId,
            extractedAt: Date.now()
          }];
        }
      }
    }

    // Check if subject with global ID already exists
    try {
      const existingSubjects = await this.listSubjects();
      for (const existingId of existingSubjects) {
        const existing = await this.getSubject(existingId);
        if (existing && existing.id === globalId) {
          // Subject exists - merge sources instead of creating duplicate
          console.log(`[SubjectMemoryPlan] Subject "${globalId}" already exists, merging sources`);

          const mergedSources = [...(existing.sources || [])];

          // Add new sources that don't already exist
          for (const newSource of sources) {
            const exists = mergedSources.some(
              s => s.type === newSource.type && s.id === newSource.id
            );
            if (!exists) {
              mergedSources.push(newSource);
            }
          }

          // Merge keywords (keeping SHA256IdHash<Keyword>[] type)
          const existingKeywordSet = new Set<SHA256IdHash<Keyword>>(existing.keywords || []);
          const newKeywordHashes = params.keywords
            ? await this.convertKeywordsToHashes(params.keywords)
            : [];
          for (const kw of newKeywordHashes) {
            existingKeywordSet.add(kw);
          }

          // Update existing subject
          const updateResult = await this.subjectPlan.updateSubject(existingId, {
            description: params.description,
            keywords: Array.from(existingKeywordSet),
            sources: mergedSources
          } as any);

          // Update index
          const updated = await this.getSubject(existingId);
          if (updated && this.indexInitialized) {
            this.index.updateSubject(createIndexEntry({
              idHash: updated.id as SHA256IdHash<any>,
              name: updated.description || updated.id,  // Use description as name
              keywords: updated.keywords,
              metadata: undefined                        // metadata is now Supply objects
            }));
          }

          return updateResult;
        }
      }
    } catch (error) {
      // Continue with creation if check fails
      console.warn('[SubjectMemoryPlan] Error checking for existing subject:', error);
    }

    // Convert keyword strings to SHA256IdHash<Keyword>[]
    const keywordHashes = params.keywords
      ? await this.convertKeywordsToHashes(params.keywords)
      : [];

    // Create new subject with global ID
    const result = await this.subjectPlan.createSubject({
      id: globalId,
      description: params.description,
      keywords: keywordHashes as any,  // SubjectPlan expects string[], we convert to hashes first
      sources
    } as any);

    // Cache the created subject immediately (no need to query it back!)
    // Use canonical Subject type with proper keyword SHA256IdHash references
    const created = {
      $type$: 'Subject' as const,
      id: globalId,
      topic: sources[0]?.id || '', // Use first source as topic for backward compat
      keywords: keywordHashes,     // SHA256IdHash<Keyword>[] from helper
      timeRanges: [{ start: Date.now(), end: Date.now() }],
      messageCount: 1,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      description: params.description,
      sources, // Multi-topic support
      archived: false
    } as Subject;
    this.subjectCache.set(String(result.idHash), created);

    // Update index
    if (this.indexInitialized) {
      this.index.addSubject(createIndexEntry({
        idHash: created.id as SHA256IdHash<any>,
        name: created.description || created.id,  // Use description as name
        keywords: created.keywords,
        metadata: undefined                        // metadata is now Supply objects
      }));
    }

    return result;
  }

  /**
   * Get a subject by its idHash
   */
  async getSubject(
    idHash: SHA256IdHash<any>,
    options: { verifySignature?: boolean } = {}
  ): Promise<Subject | null> {
    // Check cache first
    const cached = this.subjectCache.get(String(idHash));
    if (cached) {
      return cached;
    }

    // Fall back to storage query
    const subject = await this.subjectPlan.getSubject(idHash, options);
    if (subject) {
      this.subjectCache.set(String(idHash), subject);
    }
    return subject;
  }

  /**
   * Update a subject
   */
  async updateSubject(
    idHash: SHA256IdHash<any>,
    updates: UpdateSubjectParams
  ): Promise<StoreAssemblyResult> {
    const result = await this.subjectPlan.updateSubject(idHash, updates);

    // Update index
    if (this.indexInitialized) {
      const updated = await this.getSubject(idHash);
      if (updated) {
        this.index.updateSubject(createIndexEntry({
          idHash: updated.id as SHA256IdHash<any>,
          name: updated.description || updated.id,  // Use description as name
          keywords: updated.keywords,
          metadata: undefined                        // metadata is now Supply objects
        }));
      }
    }

    return result;
  }

  /**
   * Delete a subject
   */
  async deleteSubject(idHash: SHA256IdHash<any>): Promise<boolean> {
    const result = await this.subjectPlan.deleteSubject(idHash);

    // Update index
    if (result && this.indexInitialized) {
      this.index.removeSubject(idHash);
    }

    return result;
  }

  /**
   * List all subjects
   */
  async listSubjects(): Promise<SHA256IdHash<any>[]> {
    return await this.subjectPlan.listSubjects();
  }

  /**
   * Get raw HTML for a subject
   */
  async getSubjectHtml(idHash: SHA256IdHash<any>): Promise<string | null> {
    const filePath = this.subjectPlan.storageService.getFilePath(idHash, 'subjects');
    return await this.subjectPlan.storageService.readRawHtml(idHash, 'subjects');
  }

  /**
   * Search subjects by keywords (Phase 2: New global search)
   *
   * Uses SubjectIndex for fast O(1) keyword lookups with Jaccard similarity
   *
   * @param keywords Array of keywords to search for
   * @param limit Maximum number of results (default: 10)
   * @returns Array of matching subjects with relevance scores
   */
  async searchByKeywords(keywords: string[], limit: number = 10): Promise<SubjectMatch[]> {
    await this.ensureIndex();
    return this.index.findSimilar(keywords, limit);
  }

  /**
   * Find similar subjects to a given subject (Phase 2: New global search)
   *
   * @param idHash Subject ID to find similar subjects for
   * @param limit Maximum number of results (default: 10)
   * @returns Array of similar subjects with relevance scores
   */
  async findSimilar(idHash: SHA256IdHash<any>, limit: number = 10): Promise<SubjectMatch[]> {
    const subject = await this.getSubject(idHash);
    if (!subject || !subject.keywords) {
      return [];
    }

    await this.ensureIndex();
    const matches = this.index.findSimilar(subject.keywords, limit + 1); // +1 to account for self

    // Filter out the subject itself
    return matches.filter(m => String(m.idHash) !== String(idHash)).slice(0, limit);
  }

  /**
   * Get all subjects that were extracted from a specific chat (Phase 2: New filter)
   *
   * @param topicId Chat topic ID
   * @returns Array of subjects mentioned in this chat
   */
  async getSubjectsForChat(topicId: string): Promise<Subject[]> {
    const allSubjectIds = await this.listSubjects();
    const chatSubjects: Subject[] = [];

    for (const idHash of allSubjectIds) {
      const subject = await this.getSubject(idHash);
      if (!subject) continue;

      // Check if this chat is in the sources
      const hasChat = subject.sources?.some(s => s.type === 'chat' && s.id === topicId);
      if (hasChat) {
        chatSubjects.push(subject);
      }
    }

    return chatSubjects;
  }

  /**
   * Get all chats that mention a specific subject (Phase 2: New reverse lookup)
   *
   * @param idHash Subject ID
   * @returns Array of topic IDs that mention this subject
   */
  async getChatsForSubject(idHash: SHA256IdHash<any>): Promise<string[]> {
    const subject = await this.getSubject(idHash);
    if (!subject || !subject.sources) {
      return [];
    }

    return subject.sources
      .filter(s => s.type === 'chat')
      .map(s => s.id);
  }

  /**
   * Get index statistics (Phase 2: New diagnostic method)
   */
  getIndexStats(): { initialized: boolean; stats?: any } {
    if (!this.indexInitialized) {
      return { initialized: false };
    }

    return {
      initialized: true,
      stats: this.index.getStats()
    };
  }

  /**
   * Get relevant context for a message by extracting keywords and finding matching subjects
   * Platform-agnostic business logic for memory_context MCP tool
   *
   * TODO (Phase 4): Move this to ChatMemoryPlan - it iterates chats which violates
   * the separation between general memory (MemoryPlan) and chat-specific (ChatMemoryPlan)
   */
  async getContextForMessage(message: string, limit: number = 5): Promise<{
    keywords: string[];
    subjects: Array<{
      subject: any;
      topicId: string;
      matchingKeywords: string[];
      relevanceScore: number;
    }>;
  }> {
    if (!this.topicAnalysisModel) {
      throw new Error('Topic analysis not available - MemoryPlan not fully initialized');
    }

    if (!this.channelManager) {
      throw new Error('Channel manager not available - MemoryPlan not fully initialized');
    }

    // Extract keywords from the message
    const keywords = await this.topicAnalysisModel.extractKeywords(message);

    if (!keywords || keywords.length === 0) {
      return { keywords: [], subjects: [] };
    }

    // Get all subjects across all topics
    // Query Subject objects from global memory storage (using canonical Subject type)
    const allSubjectIds = await this.listSubjects();
    const relevantSubjects = [];

    for (const subjectId of allSubjectIds) {
      try {
        const subject = await this.getSubject(subjectId);
        if (!subject) continue;

        const subjectKeywords = subject.keywords || [];
        const matchingKeywords = keywords.filter((kw: string) =>
          subjectKeywords.some((sk: string) =>
            sk.toLowerCase().includes(kw.toLowerCase()) ||
            kw.toLowerCase().includes(sk.toLowerCase())
          )
        );

        if (matchingKeywords.length > 0) {
          // Extract topicId from sources (use first chat source)
          const chatSource = subject.sources?.find(s => s.type === 'chat');
          const topicId = chatSource?.id || 'unknown';

          relevantSubjects.push({
            subject,
            topicId,
            matchingKeywords,
            relevanceScore: matchingKeywords.length
          });
        }
      } catch (e) {
        // Skip invalid subjects
      }
    }

    // Sort by relevance and limit
    relevantSubjects.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topResults = relevantSubjects.slice(0, limit);

    return {
      keywords,
      subjects: topResults
    };
  }

  /**
   * Convert keyword strings to SHA256IdHash<Keyword>[]
   * Helper method that creates Keyword objects and returns their hashes
   */
  private async convertKeywordsToHashes(keywords: string[]): Promise<any[]> {
    return await keywordsToHashes(keywords);
  }
}
