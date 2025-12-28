/**
 * IngestionPlan - Document ingestion for knowledge extraction
 *
 * Creates an ingestion topic and posts a document summary with the full
 * document as attachment, triggering AI knowledge extraction.
 *
 * Platform-agnostic: Uses ONE.core for storage, depends on lama.core
 * plans for AI and topic management.
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import { storeArrayBufferAsBlob } from '@refinio/one.core/lib/storage-blob.js';

/**
 * System prompt for document knowledge extraction
 */
const INGESTION_SYSTEM_PROMPT = `You are processing a document for knowledge extraction.

Your task:
1. Read the document thoroughly
2. Create a parent memory subject summarizing the document (title, authors, date, abstract/summary, key topics)
3. Extract distinct concepts, findings, or entities as child subjects
4. Identify people mentioned - create contacts for significant ones (authors, researchers cited)

Use these tools:
- memory_store: Store a memory (insight, learning, or important information)
- memory_subjects: Check existing subjects to avoid duplicates

Be thorough but not exhaustive. Focus on:
- Core claims and findings
- Named entities (people, organizations, methods)
- Concepts the user might want to reference later

Stream your work as you go. Explain what you're extracting and why.`;

/**
 * Parameters for starting document ingestion
 */
export interface IngestionParams {
  /** Document title (from filename or extracted) */
  title: string;
  /** Document content (extracted text) */
  content: string;
  /** Original document as blob for attachment */
  documentBlob?: ArrayBuffer;
  /** Document MIME type */
  mimeType: string;
  /** Original filename */
  filename: string;
  /** Document metadata */
  metadata?: {
    author?: string;
    pageCount?: number;
    creationDate?: Date;
  };
  /** Model to use for extraction (optional, uses default) */
  modelId?: string;
}

/**
 * Result of starting ingestion
 */
export interface IngestionResult {
  success: boolean;
  /** ID of the created ingestion topic */
  topicId?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * TopicModel interface (subset we need)
 */
interface TopicModel {
  createTopic(
    displayName: string,
    participants: SHA256IdHash<Person>[],
    topicId: string,
    creator: SHA256IdHash<Person>
  ): Promise<any>;  // Returns Topic but we don't use it
  enterTopicRoom(topicId: string): Promise<TopicRoom>;
}

/**
 * TopicRoom interface (subset we need)
 * Note: hash uses SHA256Hash (defaults to OneObjectTypes) to match one.models
 */
interface TopicRoom {
  sendMessage(content: string, sender: SHA256IdHash<Person>): Promise<void>;
  sendMessageWithAttachmentAsHash(
    content: string,
    attachments: Array<{
      hash: SHA256Hash;
      type: string;
      metadata?: {
        name?: string;
        mimeType?: string;
        size?: number;
        extractedText?: string;
      };
    }>,
    sender: SHA256IdHash<Person>
  ): Promise<void>;
}

/**
 * LeuteModel interface (subset we need)
 */
interface LeuteModel {
  myMainIdentity(): Promise<SHA256IdHash<Person>>;
}

/**
 * AIAssistantPlan interface (subset we need)
 */
interface AIAssistantPlan {
  getLamaTopicId?(): string | null;
  getAIPersonForTopic?(topicId: string): SHA256IdHash<Person> | null;
  getAIContacts?(): Promise<Array<{ personId: SHA256IdHash<Person> }>>;
  registerAITopic?(topicId: string, aiPersonId: SHA256IdHash<Person>): void;
  setTopicDisplayName?(topicId: string, displayName: string): void;
}

/**
 * AIPlan interface (subset we need for summary generation)
 */
interface AIPlan {
  chat(request: {
    messages: Array<{ role: string; content: string }>;
    stream?: boolean;
  }): Promise<{
    success: boolean;
    data?: { response: string };
    error?: string;
  }>;
}

/**
 * Dependencies injected into IngestionPlan
 */
export interface IngestionDependencies {
  /** TopicModel for creating topics and sending messages */
  topicModel: TopicModel;

  /** LeuteModel for getting user identity */
  leuteModel: LeuteModel;

  /** AIAssistantPlan for AI topic management */
  aiAssistantPlan: AIAssistantPlan;

  /** AIPlan for LLM operations (summary generation) */
  aiPlan: AIPlan;
}

/**
 * IngestionPlan - Document ingestion for knowledge extraction
 *
 * Flow:
 * 1. Generate summary of document via AIPlan
 * 2. Create topic with user + AI as participants
 * 3. Post summary as first message with full document as attachment
 * 4. Post system instruction to trigger AI extraction
 */
export class IngestionPlan {
  constructor(private deps: IngestionDependencies) {}

  /**
   * Start a document ingestion session.
   *
   * Creates a new private topic with the document summary as the first message
   * and the full document attached. The AI will analyze and extract knowledge.
   */
  async startIngestion(params: IngestionParams): Promise<IngestionResult> {
    try {
      // Get current user
      const userPersonId = await this.deps.leuteModel.myMainIdentity();
      if (!userPersonId) {
        return {
          success: false,
          error: 'User identity not available'
        };
      }

      // Generate topic ID from title
      const safeTitle = params.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 30);
      const topicId = `${userPersonId}:ingestion-${safeTitle}-${Date.now()}`;

      // Get AI person for this topic
      const aiPersonId = await this.getAIPersonId();
      if (!aiPersonId) {
        return {
          success: false,
          error: 'AI not initialized - please set up a model first'
        };
      }

      // Generate document summary using AIPlan
      const summary = await this.generateSummary(params.title, params.content);

      // Create the topic with both user and AI as participants
      const displayName = `📄 ${params.title}`;
      await this.deps.topicModel.createTopic(
        displayName,
        [userPersonId, aiPersonId],
        topicId,
        userPersonId
      );

      // Register as AI topic
      this.deps.aiAssistantPlan.registerAITopic?.(topicId, aiPersonId);
      this.deps.aiAssistantPlan.setTopicDisplayName?.(topicId, displayName);

      // Enter topic room
      const topicRoom = await this.deps.topicModel.enterTopicRoom(topicId);

      // Store document as attachment if provided
      let attachmentRef: {
        hash: SHA256Hash;
        name: string;
        mimeType: string;
        size: number;
      } | null = null;

      if (params.documentBlob) {
        const blobResult = await storeArrayBufferAsBlob(params.documentBlob);
        // Cast BLOB hash to SHA256Hash to match one.models interface
        // (one.models uses SHA256Hash<OneObjectTypes> which doesn't include BLOB)
        attachmentRef = {
          hash: blobResult.hash as unknown as SHA256Hash,
          name: params.filename,
          mimeType: params.mimeType,
          size: params.documentBlob.byteLength
        };
      }

      // Build the document message with summary
      const documentMessage = [
        `# Document: ${params.title}`,
        params.metadata?.author ? `**Author:** ${params.metadata.author}` : '',
        params.metadata?.pageCount ? `**Pages:** ${params.metadata.pageCount}` : '',
        '',
        '---',
        '',
        summary
      ].filter(Boolean).join('\n');

      if (attachmentRef) {
        // Send message with attachment
        // Include extractedText in metadata so AI can access full document content
        await topicRoom.sendMessageWithAttachmentAsHash(
          documentMessage,
          [{
            hash: attachmentRef.hash,
            type: 'BLOB',
            metadata: {
              name: attachmentRef.name,
              mimeType: attachmentRef.mimeType,
              size: attachmentRef.size,
              extractedText: params.content  // Full document text for AI context
            }
          }],
          userPersonId
        );
      } else {
        // No attachment, include full content in message
        const fullDocumentMessage = [
          `# Document: ${params.title}`,
          params.metadata?.author ? `**Author:** ${params.metadata.author}` : '',
          params.metadata?.pageCount ? `**Pages:** ${params.metadata.pageCount}` : '',
          '',
          '---',
          '',
          `**Summary:**\n${summary}`,
          '',
          '**Full Content:**',
          params.content
        ].filter(Boolean).join('\n');
        await topicRoom.sendMessage(fullDocumentMessage, userPersonId);
      }

      // Post system instruction as AI message to trigger extraction
      const systemMessage = `I'll analyze this document and extract key knowledge for your memory.\n\n${INGESTION_SYSTEM_PROMPT}`;
      await topicRoom.sendMessage(systemMessage, aiPersonId);

      console.log('[IngestionPlan] Created ingestion topic:', topicId);

      return {
        success: true,
        topicId
      };
    } catch (err) {
      console.error('[IngestionPlan] Failed to start ingestion:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  }

  /**
   * Get AI person ID from AIAssistantPlan
   */
  private async getAIPersonId(): Promise<SHA256IdHash<Person> | null> {
    // First check if there's a lama topic to get the default AI from
    const lamaTopicId = this.deps.aiAssistantPlan.getLamaTopicId?.();
    if (lamaTopicId) {
      const aiPersonId = this.deps.aiAssistantPlan.getAIPersonForTopic?.(lamaTopicId);
      if (aiPersonId) return aiPersonId;
    }

    // If no AI found from lama topic, try to get any registered AI contact
    const aiContacts = await this.deps.aiAssistantPlan.getAIContacts?.();
    if (aiContacts && aiContacts.length > 0) {
      return aiContacts[0].personId;
    }

    return null;
  }

  /**
   * Generate document summary using AIPlan
   */
  private async generateSummary(title: string, content: string): Promise<string> {
    try {
      console.log('[IngestionPlan] Generating document summary...');
      const response = await this.deps.aiPlan.chat({
        messages: [{
          role: 'user',
          content: `Please provide a brief summary (2-3 sentences) of the following document titled "${title}". Focus on the main topic and key points:\n\n${content.slice(0, 10000)}`
        }],
        stream: false
      });

      if (response.success && response.data?.response) {
        console.log('[IngestionPlan] Summary generated:', response.data.response.slice(0, 100) + '...');
        return response.data.response;
      }

      // Fallback to truncated content
      console.warn('[IngestionPlan] Summary generation returned no data, using truncated content');
      return content.slice(0, 500) + '...';
    } catch (err) {
      console.warn('[IngestionPlan] Summary generation failed, using truncated content:', err);
      return content.slice(0, 500) + '...';
    }
  }
}
