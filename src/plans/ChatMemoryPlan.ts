/**
 * Chat Memory Plan
 * Platform-agnostic plan for chat-memory integration
 */

import type { SHA256IdHash } from '../types/one-core-types.js';
import type { ChatMemoryService } from '../services/ChatMemoryService.js';
import type {
  ChatMemoryConfig,
  ChatMemoryAssociation,
  ExtractSubjectsRequest,
  ExtractSubjectsResponse,
  FindRelatedMemoriesRequest,
  FindRelatedMemoriesResponse
} from '../types/chat-memory-types.js';

export interface ChatMemoryPlanDependencies {
  chatMemoryService: ChatMemoryService;
}

/**
 * ChatMemoryPlan
 *
 * Provides plan methods for chat-memory operations:
 * - Enable/disable memories per topic
 * - Extract subjects from chat messages
 * - Find related memories by keywords
 * - Manage memory updates
 */
export class ChatMemoryPlan {
  constructor(private deps: ChatMemoryPlanDependencies) {}

  /**
   * Enable memory extraction for a chat topic
   */
  async enableMemories(params: {
    topicId: SHA256IdHash<any>;
    autoExtract?: boolean;
    keywords?: string[];
  }): Promise<ChatMemoryConfig> {
    const { topicId, autoExtract = true, keywords = [] } = params;
    return await this.deps.chatMemoryService.enableMemories(topicId, {
      autoExtract,
      keywords
    });
  }

  /**
   * Disable memory extraction for a chat topic
   */
  async disableMemories(params: { topicId: SHA256IdHash<any> }): Promise<void> {
    await this.deps.chatMemoryService.disableMemories(params.topicId);
  }

  /**
   * Toggle memory extraction for a chat topic
   */
  async toggleMemories(params: { topicId: SHA256IdHash<any> }): Promise<boolean> {
    const isEnabled = this.deps.chatMemoryService.isEnabled(params.topicId);

    if (isEnabled) {
      await this.disableMemories(params);
      return false;
    } else {
      await this.enableMemories(params);
      return true;
    }
  }

  /**
   * Get memory status for a chat topic
   */
  getMemoryStatus(params: { topicId: SHA256IdHash<any> }): {
    enabled: boolean;
    config?: ChatMemoryConfig;
  } {
    const enabled = this.deps.chatMemoryService.isEnabled(params.topicId);
    const config = this.deps.chatMemoryService.getConfig(params.topicId);

    return { enabled, config };
  }

  /**
   * Extract subjects from chat messages and store as memories
   */
  async extractSubjects(
    params: ExtractSubjectsRequest
  ): Promise<ExtractSubjectsResponse> {
    return await this.deps.chatMemoryService.extractAndStoreSubjects(params);
  }

  /**
   * Find related memories for a chat topic
   */
  async findRelatedMemories(params: {
    topicId?: SHA256IdHash<any>;
    keywords: string[];
    limit?: number;
  }): Promise<FindRelatedMemoriesResponse> {
    return await this.deps.chatMemoryService.findRelatedMemories({
      topicId: params.topicId,
      keywords: params.keywords,
      limit: params.limit ?? 10,
      minRelevance: 0.3
    });
  }

  /**
   * Get all memory associations for a chat topic
   */
  async getAssociations(params: { topicId: SHA256IdHash<any> }): Promise<ChatMemoryAssociation[]> {
    return await this.deps.chatMemoryService.getAssociations(params.topicId);
  }

  /**
   * Update a memory with new information from chat
   */
  async updateMemoryFromChat(params: {
    subjectIdHash: SHA256IdHash<any>;
    topicId: SHA256IdHash<any>;
    newKeywords: string[];
    additionalDescription?: string;
  }): Promise<void> {
    await this.deps.chatMemoryService.updateMemory(
      params.subjectIdHash,
      params.topicId,
      params.newKeywords,
      params.additionalDescription
    );
  }

  /**
   * Auto-extract subjects from recent messages in a topic
   *
   * This is typically called:
   * - When memories are first enabled
   * - Periodically for active chats
   * - On demand from UI
   */
  async autoExtractFromTopic(params: {
    topicId: SHA256IdHash<any>;
    messageLimit?: number;
  }): Promise<ExtractSubjectsResponse> {
    if (!this.deps.chatMemoryService.isEnabled(params.topicId)) {
      throw new Error(`Memories not enabled for topic: ${params.topicId}`);
    }

    return await this.extractSubjects({
      topicId: params.topicId,
      limit: params.messageLimit ?? 50,
      includeContext: true
    });
  }

  /**
   * Get memory suggestions for current chat context
   *
   * Returns relevant memories based on recent message keywords
   */
  async getMemorySuggestions(params: {
    topicId: SHA256IdHash<any>;
    recentKeywords: string[];
    limit?: number;
  }): Promise<FindRelatedMemoriesResponse> {
    return await this.findRelatedMemories({
      topicId: params.topicId,
      keywords: params.recentKeywords,
      limit: params.limit ?? 5
    });
  }
}
