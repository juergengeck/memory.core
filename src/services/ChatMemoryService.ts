/**
 * Chat Memory Service
 * Manages automatic extraction of subjects from chat and storage as memories
 */

import type { SHA256Hash, SHA256IdHash } from '../types/one-core-types.js';
import type {
  ChatMemoryConfig,
  ChatMemoryAssociation,
  ExtractedSubject,
  RelatedMemory,
  ExtractSubjectsRequest,
  ExtractSubjectsResponse,
  FindRelatedMemoriesRequest,
  FindRelatedMemoriesResponse
} from '../types/chat-memory-types.js';

/**
 * Embedding provider interface for semantic search
 */
export interface EmbeddingProvider {
  readonly model: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface ChatMemoryServiceDependencies {
  nodeOneCore: any;
  topicAnalyzer?: any;            // From one-ai for subject extraction
  memoryPlan?: any;               // MemoryPlan for storing subjects
  storeVersionedObject?: any;     // For storing associations
  getObjectByIdHash?: any;        // For retrieving associations
  embeddingProvider?: EmbeddingProvider;  // For semantic similarity search
}

/**
 * ChatMemoryService
 *
 * Automatically extracts subjects from chat messages and stores them as memories.
 * Provides semantic (embedding-based) and keyword-based retrieval.
 */
export class ChatMemoryService {
  private configs: Map<string, ChatMemoryConfig> = new Map();
  private associations: Map<string, ChatMemoryAssociation[]> = new Map();

  // Embedding cache: subjectIdHash -> embedding vector
  private embeddingCache: Map<string, number[]> = new Map();

  constructor(private deps: ChatMemoryServiceDependencies) {}

  /**
   * Check if semantic search is available
   */
  get hasSemanticSearch(): boolean {
    return !!this.deps.embeddingProvider;
  }

  /**
   * Enable memory extraction for a topic
   */
  async enableMemories(
    topicId: SHA256IdHash<any>,
    config: Partial<ChatMemoryConfig> = {}
  ): Promise<ChatMemoryConfig> {
    const memoryConfig: ChatMemoryConfig = {
      topicId,
      enabled: true,
      autoExtract: config.autoExtract ?? true,
      updateInterval: config.updateInterval ?? 60000, // 1 minute
      minConfidence: config.minConfidence ?? 0.5,
      keywords: config.keywords ?? []
    };

    this.configs.set(topicId, memoryConfig);

    // Store config in ONE.core
    if (this.deps.storeVersionedObject) {
      await this.deps.storeVersionedObject({
        $type$: 'ChatMemoryConfig',
        ...memoryConfig
      });
    }

    return memoryConfig;
  }

  /**
   * Disable memory extraction for a topic
   */
  async disableMemories(topicId: SHA256IdHash<any>): Promise<void> {
    const config = this.configs.get(topicId);
    if (config) {
      config.enabled = false;
      this.configs.set(topicId, config);

      // Update stored config
      if (this.deps.storeVersionedObject) {
        await this.deps.storeVersionedObject({
          $type$: 'ChatMemoryConfig',
          ...config
        });
      }
    }
  }

  /**
   * Check if memories are enabled for a topic
   */
  isEnabled(topicId: SHA256IdHash<any>): boolean {
    const config = this.configs.get(topicId);
    return config?.enabled ?? false;
  }

  /**
   * Get memory configuration for a topic
   */
  getConfig(topicId: SHA256IdHash<any>): ChatMemoryConfig | undefined {
    return this.configs.get(topicId);
  }

  /**
   * Extract subjects from messages and store as memories
   */
  async extractAndStoreSubjects(
    request: ExtractSubjectsRequest
  ): Promise<ExtractSubjectsResponse> {
    const startTime = Date.now();

    if (!this.isEnabled(request.topicId)) {
      throw new Error(`Memories not enabled for topic: ${request.topicId}`);
    }

    if (!this.deps.topicAnalyzer) {
      throw new Error('Topic analyzer not available');
    }

    if (!this.deps.memoryPlan) {
      throw new Error('Memory plan not available');
    }

    const config = this.getConfig(request.topicId);

    // Get messages to analyze
    const messages = await this.getMessages(request.topicId, request.messageIds, request.limit);

    // Extract keywords and subjects using TopicAnalyzer
    const extractedSubjects: ExtractedSubject[] = [];
    const allKeywords = new Map<string, number>(); // keyword -> frequency

    for (const message of messages) {
      try {
        // ObjectData wraps the actual message in .data property
        const msgData = (message as any).data || message;
        const messageText = msgData.text || msgData.content || message.text || message.content;
        console.log('[ChatMemoryService] Extracting keywords from message:', messageText?.substring(0, 100));

        // Extract keywords from message content
        const keywords = await this.deps.topicAnalyzer.extractKeywords(
          messageText,
          10 // max keywords per message
        );

        console.log('[ChatMemoryService] Extracted keywords:', keywords);

        if (keywords && keywords.length > 0) {
          // Track keyword frequency
          for (const keyword of keywords) {
            const normalized = String(keyword).toLowerCase();
            allKeywords.set(normalized, (allKeywords.get(normalized) || 0) + 1);
          }

          // Create subject from message keywords
          // Use top 3 keywords as subject identifier
          const topKeywords = keywords.slice(0, 3);
          const subjectName = topKeywords.join(' ');

          // Calculate confidence based on keyword count and quality
          // Keywords extracted = high confidence in that message's relevance
          const keywordCount = keywords.length;
          const confidence = Math.min(keywordCount / 10, 1.0);  // 10 keywords = max confidence

          console.log('[ChatMemoryService] Subject:', subjectName, 'confidence:', confidence);

          // Filter by minimum confidence (default 0.1 - any extracted keywords are useful)
          if (confidence >= (config?.minConfidence ?? 0.1)) {
            extractedSubjects.push({
              name: subjectName,
              keywords: topKeywords.map(k => String(k)),
              confidence,
              description: this.getExcerpt(messageText, 150),
              messageExcerpt: this.getExcerpt(messageText, 200)
            });
          }
        }
      } catch (error) {
        console.error('[ChatMemoryService] Error extracting keywords from message:', error);
      }
    }

    // Store unique subjects as memories
    const uniqueSubjects = this.deduplicateSubjects(extractedSubjects);

    for (const subject of uniqueSubjects) {
      await this.storeSubjectAsMemory(request.topicId, subject);
    }

    return {
      subjects: extractedSubjects,
      totalMessages: messages.length,
      processingTime: Date.now() - startTime
    };
  }

  /**
   * Find related memories by semantic similarity or keywords
   * Uses embedding-based search when provider available, falls back to keywords
   */
  async findRelatedMemories(
    request: FindRelatedMemoriesRequest
  ): Promise<FindRelatedMemoriesResponse> {
    if (!this.deps.memoryPlan) {
      throw new Error('Memory plan not available');
    }

    // Ensure keywords is always an array (MCP may pass comma-separated string)
    let keywords: string[] = request.keywords;
    if (!Array.isArray(keywords)) {
      if (typeof keywords === 'string') {
        keywords = (keywords as string).split(',').map(k => k.trim()).filter(k => k.length > 0);
      } else {
        keywords = [];
      }
    }

    const allSubjectIds = await this.deps.memoryPlan.listSubjects();
    const relatedMemories: RelatedMemory[] = [];

    // Use semantic search if embedding provider available
    if (this.deps.embeddingProvider && keywords.length > 0) {
      return this.findBySemanticSimilarity(keywords, allSubjectIds, request);
    }

    // Fallback to keyword-based search
    for (const idHash of allSubjectIds) {
      const subject = await this.deps.memoryPlan.getSubject(idHash);

      if (!subject) continue;

      // Calculate relevance score based on keyword overlap
      const subjectKeywords = this.extractKeywordsFromSubject(subject);
      const relevanceScore = this.calculateRelevance(
        keywords,
        subjectKeywords
      );

      if (relevanceScore >= (request.minRelevance ?? 0.3)) {
        relatedMemories.push({
          subjectIdHash: idHash,
          name: subject.name,
          keywords: subjectKeywords,
          relevanceScore,
          lastUpdated: subject.modified ?? subject.created
        });
      }
    }

    // Sort by relevance
    relatedMemories.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Limit results
    const limited = request.limit
      ? relatedMemories.slice(0, request.limit)
      : relatedMemories;

    return {
      memories: limited,
      searchKeywords: keywords,
      totalFound: relatedMemories.length
    };
  }

  /**
   * Get associations for a topic
   */
  async getAssociations(topicId: SHA256IdHash<any>): Promise<ChatMemoryAssociation[]> {
    return this.associations.get(topicId) || [];
  }

  /**
   * Update an existing memory with new information
   */
  async updateMemory(
    subjectIdHash: SHA256IdHash<any>,
    topicId: SHA256IdHash<any>,
    newKeywords: string[],
    additionalDescription?: string
  ): Promise<void> {
    if (!this.deps.memoryPlan) {
      throw new Error('Memory plan not available');
    }

    const subject = await this.deps.memoryPlan.getSubject(subjectIdHash);

    if (!subject) {
      throw new Error(`Subject not found: ${subjectIdHash}`);
    }

    // Merge keywords
    const existingKeywords = this.extractKeywordsFromSubject(subject);
    const mergedKeywords = [...new Set([...existingKeywords, ...newKeywords])];

    // Update description if provided
    let description = subject.description || '';
    if (additionalDescription) {
      description = description
        ? `${description}\n\n${additionalDescription}`
        : additionalDescription;
    }

    // Update metadata
    const metadata = subject.metadata || new Map();
    metadata.set('keywords', mergedKeywords.join(','));
    metadata.set('lastUpdatedFrom', topicId);
    metadata.set('lastUpdatedAt', Date.now().toString());

    // Store updated version
    await this.deps.memoryPlan.updateSubject(subjectIdHash, {
      description,
      metadata
    });

    // Update association
    await this.updateAssociation(topicId, subjectIdHash, mergedKeywords);
  }

  // Private helper methods

  private async getMessages(
    topicId: SHA256IdHash<any>,
    messageIds?: SHA256Hash<any>[],
    limit?: number
  ): Promise<any[]> {
    const { topicModel, leuteModel, channelManager } = this.deps.nodeOneCore || {};
    if (!topicModel || !leuteModel || !channelManager) {
      throw new Error('TopicModel, LeuteModel, or ChannelManager not available');
    }

    try {
      // Find topic
      const topic = await topicModel.findTopic(topicId);
      if (!topic) {
        console.warn(`[ChatMemoryService] Topic not found: ${topicId}`);
        return [];
      }

      // Import TopicRoom dynamically to avoid circular deps
      const { default: TopicRoom } = await import('@refinio/one.models/lib/models/Chat/TopicRoom.js');
      const topicRoom = new TopicRoom(topic, channelManager, leuteModel);

      // Retrieve all messages - ObjectData<ChatMessage>[] with proper typing from ONE.core
      let messages = await topicRoom.retrieveAllMessages();

      // Filter by specific message IDs if provided
      if (messageIds && messageIds.length > 0) {
        const idSet = new Set(messageIds);
        messages = messages.filter((m: any) => idSet.has(m.dataHash));
      }

      // Sort by creationTime (newest first) - ObjectData has creationTime property
      messages.sort((a: any, b: any) => (b.creationTime || 0) - (a.creationTime || 0));

      // Apply limit if specified
      if (limit && limit > 0) {
        messages = messages.slice(0, limit);
      }

      return messages;
    } catch (error) {
      console.error('[ChatMemoryService] Error retrieving messages:', error);
      throw error;
    }
  }

  private getExcerpt(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  }

  private deduplicateSubjects(subjects: ExtractedSubject[]): ExtractedSubject[] {
    const seen = new Map<string, ExtractedSubject>();

    for (const subject of subjects) {
      const key = subject.name.toLowerCase();
      const existing = seen.get(key);

      if (!existing || subject.confidence > existing.confidence) {
        seen.set(key, subject);
      }
    }

    return Array.from(seen.values());
  }

  private async storeSubjectAsMemory(
    topicId: SHA256IdHash<any>,
    subject: ExtractedSubject
  ): Promise<SHA256IdHash<any>> {
    const metadata = new Map<string, string>();
    metadata.set('keywords', subject.keywords.join(','));
    metadata.set('confidence', subject.confidence.toString());
    metadata.set('extractedFrom', topicId);
    metadata.set('extractedAt', Date.now().toString());

    if (subject.messageExcerpt) {
      metadata.set('excerpt', subject.messageExcerpt);
    }

    const result = await this.deps.memoryPlan.createSubject({
      id: `chat-${topicId}-${subject.name.toLowerCase().replace(/\s+/g, '-')}`,
      name: subject.name,
      description: subject.description || subject.messageExcerpt,
      metadata,
      sign: false,
      theme: 'auto'
    });

    // Create association
    await this.createAssociation(
      topicId,
      result.idHash as SHA256IdHash<any>,
      subject.keywords,
      subject.confidence
    );

    return result.idHash as SHA256IdHash<any>;
  }

  private extractKeywordsFromSubject(subject: any): string[] {
    if (subject.metadata?.get) {
      const keywordsStr = subject.metadata.get('keywords');
      if (keywordsStr) {
        return keywordsStr.split(',').map((k: string) => k.trim());
      }
    }
    return [];
  }

  private calculateRelevance(keywords1: string[], keywords2: string[]): number {
    if (keywords1.length === 0 || keywords2.length === 0) return 0;

    const set1 = new Set(keywords1.map(k => k.toLowerCase()));
    const set2 = new Set(keywords2.map(k => k.toLowerCase()));

    let overlap = 0;
    for (const k of set1) {
      if (set2.has(k)) overlap++;
    }

    // Jaccard similarity
    const union = new Set([...set1, ...set2]).size;
    return overlap / union;
  }

  private async createAssociation(
    topicId: SHA256IdHash<any>,
    subjectIdHash: SHA256IdHash<any>,
    keywords: string[],
    confidence: number
  ): Promise<void> {
    const association: ChatMemoryAssociation = {
      $type$: 'ChatMemoryAssociation',
      id: `${topicId}-${subjectIdHash}`,
      topicId,
      subjectIdHash,
      keywords,
      confidence,
      created: Date.now(),
      lastUpdated: Date.now(),
      messageCount: 1
    };

    // Store association
    if (this.deps.storeVersionedObject) {
      await this.deps.storeVersionedObject(association);
    }

    // Add to local cache
    const existing = this.associations.get(topicId) || [];
    existing.push(association);
    this.associations.set(topicId, existing);
  }

  private async updateAssociation(
    topicId: SHA256IdHash<any>,
    subjectIdHash: SHA256IdHash<any>,
    keywords: string[]
  ): Promise<void> {
    const associations = this.associations.get(topicId) || [];
    const existing = associations.find(a => a.subjectIdHash === subjectIdHash);

    if (existing) {
      existing.keywords = keywords;
      existing.lastUpdated = Date.now();
      existing.messageCount++;

      // Update in storage
      if (this.deps.storeVersionedObject) {
        await this.deps.storeVersionedObject(existing);
      }
    }
  }

  /**
   * Find memories by semantic similarity using embeddings
   * Computes cosine similarity between query and subject embeddings
   */
  private async findBySemanticSimilarity(
    keywords: string[],
    allSubjectIds: string[],
    request: FindRelatedMemoriesRequest
  ): Promise<FindRelatedMemoriesResponse> {
    const embeddingProvider = this.deps.embeddingProvider!;
    const relatedMemories: RelatedMemory[] = [];

    // Create query text from keywords
    const queryText = keywords.join(' ');

    // Get query embedding
    const queryEmbedding = await embeddingProvider.embed(queryText);

    // Get all subjects and their embeddings
    for (const idHash of allSubjectIds) {
      const subject = await this.deps.memoryPlan!.getSubject(idHash);
      if (!subject) continue;

      // Get or compute subject embedding
      let subjectEmbedding = this.embeddingCache.get(idHash);
      if (!subjectEmbedding) {
        // Create text from subject for embedding
        const subjectText = [
          subject.name,
          subject.description,
          this.extractKeywordsFromSubject(subject).join(' ')
        ].filter(Boolean).join(' ');

        subjectEmbedding = await embeddingProvider.embed(subjectText);
        this.embeddingCache.set(idHash, subjectEmbedding);
      }

      // Calculate cosine similarity
      const similarity = this.cosineSimilarity(queryEmbedding, subjectEmbedding);

      if (similarity >= (request.minRelevance ?? 0.3)) {
        relatedMemories.push({
          subjectIdHash: idHash as any,
          name: subject.name,
          keywords: this.extractKeywordsFromSubject(subject),
          relevanceScore: similarity,
          lastUpdated: subject.modified ?? subject.created
        });
      }
    }

    // Sort by similarity (descending)
    relatedMemories.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Limit results
    const limited = request.limit
      ? relatedMemories.slice(0, request.limit)
      : relatedMemories;

    return {
      memories: limited,
      searchKeywords: keywords,
      totalFound: relatedMemories.length
    };
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Clear embedding cache (call when subjects change)
   */
  clearEmbeddingCache(): void {
    this.embeddingCache.clear();
  }
}
