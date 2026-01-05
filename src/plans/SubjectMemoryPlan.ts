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

/**
 * Tool definition for MCP/PlanRegistry
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; default?: any }>;
    required?: string[];
  };
}

/**
 * MCP-formatted tool result
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

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
 * Optional dependencies for extended memory operations
 * These enable message retrieval tools when provided
 */
export interface ExtendedMemoryDependencies {
  /** TopicModel for entering rooms and retrieving messages */
  topicModel?: {
    enterTopicRoom(topicId: string): Promise<{
      retrieveAllMessages(): Promise<any[]>;
    }>;
  };
  /** MemoryStorageHandler for storing memory assemblies */
  memoryStorageHandler?: {
    storeMemory(params: {
      content: string;
      memoryType: string;
      category?: string;
      topicRef: string;
    }): Promise<{
      success: boolean;
      error?: string;
      memoryHash?: string;
      assemblyHash?: string;
      filename?: string;
      keywords?: string[];
      subjects?: string[];
    }>;
  };
  /** AIAssistantModel for checking if sender is AI */
  aiAssistantModel?: {
    isAIPerson(personId: any): boolean;
  };
}

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
 * Phase 3 Enhancements (Tool Integration):
 * - getToolDefinitions() for MCP/PlanRegistry discovery
 * - executeTool() for unified tool execution
 * - All memory tools can be used locally AND via MCP
 *
 * NOTE: This manages Subject objects. For Memory document operations, see MemoryPlan.
 */
export class SubjectMemoryPlan {
  private index: SubjectIndex;
  private indexInitialized: boolean = false;
  private subjectCache: Map<string, Subject> = new Map(); // idHash -> subject
  private extendedDeps: ExtendedMemoryDependencies = {};

  constructor(
    private subjectPlan: any,
    private topicAnalysisModel?: any,
    private channelManager?: any
  ) {
    this.index = new SubjectIndex();
    // Index will be built lazily on first search or explicitly via buildIndex()
  }

  /**
   * Set extended dependencies for message retrieval operations
   * Call this after construction to enable full tool support
   */
  setExtendedDependencies(deps: ExtendedMemoryDependencies): void {
    this.extendedDeps = { ...this.extendedDeps, ...deps };
  }

  /**
   * Get tool definitions for MCP/PlanRegistry discovery
   * These are the same tools exposed via MCPManager but can also be called locally
   */
  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'memory_context',
        description: 'PROACTIVE TOOL: Call BEFORE responding to get relevant memories based on keywords in the user\'s message. Automatically extracts keywords and finds matching subjects.',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'The user\'s message to extract keywords from' },
            limit: { type: 'number', description: 'Maximum memory items to return', default: 5 }
          },
          required: ['message']
        }
      },
      {
        name: 'memory_store',
        description: 'Store a new memory (insight, learning, or important information) to long-term memory.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The memory content to store' },
            category: { type: 'string', description: 'Optional category for organizing memories' }
          },
          required: ['content']
        }
      },
      {
        name: 'memory_search',
        description: 'Search conversation history for relevant past discussions.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query - keywords or concepts' },
            limit: { type: 'number', description: 'Maximum messages to return', default: 10 }
          },
          required: ['query']
        }
      },
      {
        name: 'memory_recent',
        description: 'Get most recent memories from the LAMA topic.',
        inputSchema: {
          type: 'object',
          properties: {
            count: { type: 'number', description: 'Number of recent messages', default: 20 }
          }
        }
      },
      {
        name: 'memory_subjects',
        description: 'Get subjects and themes learned across all conversations.',
        inputSchema: {
          type: 'object',
          properties: {
            topicId: { type: 'string', description: 'Optional: Get subjects for specific topic' }
          }
        }
      },
      {
        name: 'subject_get-messages',
        description: 'Get full message history for a specific subject.',
        inputSchema: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'The subject name' },
            limit: { type: 'number', description: 'Maximum messages to return', default: 50 }
          },
          required: ['subject']
        }
      },
      {
        name: 'subject_search',
        description: 'Search within a specific subject for relevant messages.',
        inputSchema: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'The subject to search within' },
            query: { type: 'string', description: 'Keywords to search for' },
            limit: { type: 'number', description: 'Maximum messages to return', default: 20 }
          },
          required: ['subject', 'query']
        }
      }
    ];
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

  // ============================================================================
  // Tool Execution Methods (Phase 3: Unified local/MCP tool support)
  // ============================================================================

  /**
   * Execute a tool by name
   * Unified dispatcher for both local and MCP invocations
   *
   * @param toolName Tool name (e.g., 'memory_context')
   * @param params Tool parameters
   * @returns MCP-formatted result
   */
  async executeTool(toolName: string, params: Record<string, any>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case 'memory_context':
          return await this.toolMemoryContext(params.message, params.limit || 5);

        case 'memory_store':
          return await this.toolMemoryStore(params.content, params.category);

        case 'memory_search':
          return await this.toolMemorySearch(params.query, params.limit || 10);

        case 'memory_recent':
          return await this.toolMemoryRecent(params.count || 20);

        case 'memory_subjects':
          return await this.toolMemorySubjects(params.topicId);

        case 'subject_get-messages':
          return await this.toolSubjectGetMessages(params.subject, params.limit || 50);

        case 'subject_search':
          return await this.toolSubjectSearch(params.subject, params.query, params.limit || 20);

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
            isError: true
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Tool execution failed: ${message}` }],
        isError: true
      };
    }
  }

  /**
   * Tool: memory_context
   * Get relevant context for a message (wraps getContextForMessage)
   */
  private async toolMemoryContext(message: string, limit: number): Promise<ToolResult> {
    const result = await this.getContextForMessage(message, limit);

    if (result.subjects.length === 0) {
      return {
        content: [{
          type: 'text',
          text: result.keywords.length > 0
            ? `Keywords found: ${result.keywords.join(', ')}\n\nNo existing memories for these keywords - new context.`
            : 'No keywords extracted from message - no relevant context.'
        }]
      };
    }

    let contextText = `# Relevant Context\n\n`;
    contextText += `Keywords: ${result.keywords.join(', ')}\n\n`;
    contextText += `Found ${result.subjects.length} relevant subjects:\n\n`;

    for (const { subject, matchingKeywords } of result.subjects) {
      contextText += `## ${subject.keywordCombination || subject.name || subject.description}\n`;
      contextText += `**Keywords**: ${subject.keywords?.join(', ') || 'none'}\n`;
      contextText += `**Description**: ${subject.description || 'no description'}\n`;
      contextText += `**Matching**: ${matchingKeywords.join(', ')}\n\n`;
    }

    return { content: [{ type: 'text', text: contextText }] };
  }

  /**
   * Tool: memory_store
   * Store a new memory via MemoryStorageHandler
   */
  private async toolMemoryStore(content: string, category?: string): Promise<ToolResult> {
    if (!this.extendedDeps.memoryStorageHandler) {
      return {
        content: [{ type: 'text', text: 'Memory storage not available - extended dependencies not set' }],
        isError: true
      };
    }

    const result = await this.extendedDeps.memoryStorageHandler.storeMemory({
      content,
      memoryType: category || 'note',
      category,
      topicRef: 'lama'
    });

    if (!result.success) {
      return {
        content: [{ type: 'text', text: result.error || 'Failed to store memory' }],
        isError: true
      };
    }

    return {
      content: [{
        type: 'text',
        text: `Memory stored successfully\nHash: ${result.memoryHash}\nKeywords: ${result.keywords?.join(', ') || 'none'}\nSubjects: ${result.subjects?.join(', ') || 'none'}`
      }]
    };
  }

  /**
   * Tool: memory_search
   * Search LAMA topic for relevant messages
   */
  private async toolMemorySearch(query: string, limit: number): Promise<ToolResult> {
    if (!this.extendedDeps.topicModel) {
      return {
        content: [{ type: 'text', text: 'Topic model not available - extended dependencies not set' }],
        isError: true
      };
    }

    const topicRoom = await this.extendedDeps.topicModel.enterTopicRoom('lama');
    const allMessages = await topicRoom.retrieveAllMessages();

    const queryLower = query.toLowerCase();
    const matches = allMessages
      .filter((msg: any) => {
        const text = msg.data?.text || msg.text || '';
        return text.toLowerCase().includes(queryLower);
      })
      .slice(-limit);

    if (matches.length === 0) {
      return { content: [{ type: 'text', text: `No memories found matching "${query}"` }] };
    }

    const results = matches.map((msg: any, idx: number) => {
      const text = msg.data?.text || msg.text || '';
      const timestamp = msg.data?.timestamp || msg.timestamp || 'unknown';
      return `[${idx + 1}] ${timestamp}\n${text}\n`;
    }).join('\n---\n\n');

    return { content: [{ type: 'text', text: `Found ${matches.length} relevant memories:\n\n${results}` }] };
  }

  /**
   * Tool: memory_recent
   * Get recent messages from LAMA topic
   */
  private async toolMemoryRecent(count: number): Promise<ToolResult> {
    if (!this.extendedDeps.topicModel) {
      return {
        content: [{ type: 'text', text: 'Topic model not available - extended dependencies not set' }],
        isError: true
      };
    }

    const topicRoom = await this.extendedDeps.topicModel.enterTopicRoom('lama');
    const allMessages = await topicRoom.retrieveAllMessages();
    const recent = allMessages.slice(-count);

    if (recent.length === 0) {
      return { content: [{ type: 'text', text: 'No memories yet - this is the beginning of your memory.' }] };
    }

    const results = recent.map((msg: any, idx: number) => {
      const text = msg.data?.text || msg.text || '';
      const timestamp = msg.data?.timestamp || msg.timestamp || 'unknown';
      const sender = msg.data?.sender || msg.author;
      const isAI = this.extendedDeps.aiAssistantModel?.isAIPerson(sender);
      const role = isAI ? 'You' : 'User';
      return `[${idx + 1}] ${timestamp} - ${role}:\n${text}\n`;
    }).join('\n---\n\n');

    return { content: [{ type: 'text', text: `Your ${recent.length} most recent memories:\n\n${results}` }] };
  }

  /**
   * Tool: memory_subjects
   * Get subjects across conversations
   */
  private async toolMemorySubjects(topicId?: string): Promise<ToolResult> {
    if (!this.topicAnalysisModel) {
      return {
        content: [{ type: 'text', text: 'Topic analysis not available - cannot retrieve subjects' }],
        isError: true
      };
    }

    let subjects: Subject[];
    if (topicId) {
      subjects = await this.topicAnalysisModel.getSubjects(topicId);
    } else {
      // Get all subjects from all topics
      const allChannels = this.channelManager
        ? await this.channelManager.getMatchingChannelInfos()
        : [];
      subjects = [];

      for (const channel of allChannels) {
        try {
          const topicSubjects = await this.topicAnalysisModel.getSubjects(channel.id);
          subjects.push(...topicSubjects);
        } catch (e) {
          // Skip topics without subjects
        }
      }
    }

    if (!subjects || subjects.length === 0) {
      return {
        content: [{
          type: 'text',
          text: topicId
            ? `No subjects found for topic ${topicId}`
            : 'No subjects learned yet across any conversations'
        }]
      };
    }

    const activeSubjects = subjects.filter((s: any) => !s.archived);
    const formatted = activeSubjects.map((subject: any, idx: number) => {
      const keywords = subject.keywords?.join(', ') || 'no keywords';
      const desc = subject.description || 'no description';
      return `[${idx + 1}] ${subject.keywordCombination || subject.name}\n   Keywords: ${keywords}\n   ${desc}`;
    }).join('\n\n');

    return { content: [{ type: 'text', text: `You have context for ${activeSubjects.length} subjects:\n\n${formatted}` }] };
  }

  /**
   * Tool: subject_get-messages
   * Get messages for a specific subject
   */
  private async toolSubjectGetMessages(subjectName: string, limit: number): Promise<ToolResult> {
    if (!this.topicAnalysisModel || !this.extendedDeps.topicModel) {
      return {
        content: [{ type: 'text', text: 'Required dependencies not available' }],
        isError: true
      };
    }

    // Find subject by name
    const allChannels = this.channelManager
      ? await this.channelManager.getMatchingChannelInfos()
      : [];
    let targetSubject: Subject | null = null;
    let targetTopicId: string | null = null;

    for (const channel of allChannels) {
      try {
        const subjects = await this.topicAnalysisModel.getSubjects(channel.id);
        const found = subjects.find((s: any) =>
          (s.name === subjectName || s.keywordCombination === subjectName) && !s.archived
        );
        if (found) {
          targetSubject = found;
          targetTopicId = channel.id;
          break;
        }
      } catch (e) {
        // Skip
      }
    }

    if (!targetSubject || !targetTopicId) {
      return { content: [{ type: 'text', text: `Subject "${subjectName}" not found` }] };
    }

    const topicRoom = await this.extendedDeps.topicModel.enterTopicRoom(targetTopicId);
    const allMessages = await topicRoom.retrieveAllMessages();

    const keywords = (targetSubject as any).keywords || [];
    const relevantMessages = allMessages
      .filter((msg: any) => {
        const text = (msg.data?.text || msg.text || '').toLowerCase();
        return keywords.some((kw: string) => text.includes(kw.toLowerCase()));
      })
      .slice(-limit);

    if (relevantMessages.length === 0) {
      return { content: [{ type: 'text', text: `No messages found for subject "${subjectName}"` }] };
    }

    const formatted = relevantMessages.map((msg: any, idx: number) => {
      const text = msg.data?.text || msg.text || '';
      const timestamp = msg.data?.timestamp || msg.timestamp;
      const sender = msg.data?.sender || msg.author;
      const isAI = this.extendedDeps.aiAssistantModel?.isAIPerson(sender);
      const role = isAI ? 'Assistant' : 'User';
      return `[${idx + 1}] ${timestamp || 'unknown'} - ${role}:\n${text}`;
    }).join('\n\n---\n\n');

    return { content: [{ type: 'text', text: `Messages for "${subjectName}" (${relevantMessages.length}):\n\n${formatted}` }] };
  }

  /**
   * Tool: subject_search
   * Search within a specific subject
   */
  private async toolSubjectSearch(subjectName: string, query: string, limit: number): Promise<ToolResult> {
    if (!this.topicAnalysisModel || !this.extendedDeps.topicModel) {
      return {
        content: [{ type: 'text', text: 'Required dependencies not available' }],
        isError: true
      };
    }

    // Find subject by name
    const allChannels = this.channelManager
      ? await this.channelManager.getMatchingChannelInfos()
      : [];
    let targetSubject: Subject | null = null;
    let targetTopicId: string | null = null;

    for (const channel of allChannels) {
      try {
        const subjects = await this.topicAnalysisModel.getSubjects(channel.id);
        const found = subjects.find((s: any) =>
          (s.name === subjectName || s.keywordCombination === subjectName) && !s.archived
        );
        if (found) {
          targetSubject = found;
          targetTopicId = channel.id;
          break;
        }
      } catch (e) {
        // Skip
      }
    }

    if (!targetSubject || !targetTopicId) {
      return { content: [{ type: 'text', text: `Subject "${subjectName}" not found` }] };
    }

    const topicRoom = await this.extendedDeps.topicModel.enterTopicRoom(targetTopicId);
    const allMessages = await topicRoom.retrieveAllMessages();

    const keywords = (targetSubject as any).keywords || [];
    const queryLower = query.toLowerCase();

    const relevantMessages = allMessages
      .filter((msg: any) => {
        const text = (msg.data?.text || msg.text || '').toLowerCase();
        const matchesSubject = keywords.some((kw: string) => text.includes(kw.toLowerCase()));
        const matchesQuery = text.includes(queryLower);
        return matchesSubject && matchesQuery;
      })
      .slice(-limit);

    if (relevantMessages.length === 0) {
      return { content: [{ type: 'text', text: `No messages in "${subjectName}" matching "${query}"` }] };
    }

    const formatted = relevantMessages.map((msg: any, idx: number) => {
      const text = msg.data?.text || msg.text || '';
      const timestamp = msg.data?.timestamp || msg.timestamp;
      const sender = msg.data?.sender || msg.author;
      const isAI = this.extendedDeps.aiAssistantModel?.isAIPerson(sender);
      const role = isAI ? 'Assistant' : 'User';
      return `[${idx + 1}] ${timestamp || 'unknown'} - ${role}:\n${text}`;
    }).join('\n\n---\n\n');

    return { content: [{ type: 'text', text: `Search "${query}" in "${subjectName}" (${relevantMessages.length}):\n\n${formatted}` }] };
  }
}
