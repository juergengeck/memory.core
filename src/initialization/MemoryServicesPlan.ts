/**
 * Memory Services Plan
 *
 * Platform-agnostic business logic for memory initialization.
 * NO Electron imports - uses dependency injection.
 *
 * Principles:
 * - Dependency injection for platform-specific code (paths, etc.)
 * - Pure business logic only
 * - Testable in isolation
 */

import TopicAnalysisModel from '@lama/core/one-ai/models/TopicAnalysisModel.js';
import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';

/**
 * Dependencies injected by platform
 */
export interface MemoryDeps {
  getStoragePath: () => string;  // Platform-specific path resolution
  setImmediate: (fn: () => Promise<void>) => void;  // Platform-specific scheduling
}

export interface MemoryContext {
  channelManager: ChannelManager;
  topicModel: TopicModel;
  topicAnalysisModel: TopicAnalysisModel;
  nodeOneCore: any;
  llmManager: any;
}

export interface MemoryServices {
  memoryStoragePlan: any;
  fileStorageService: any;
  subjectPlan: any;
  chatMemoryPlan: any;
}

/**
 * Memory Services Plan
 * Initializes memory storage and analysis services
 */
export class MemoryServicesPlan {
  constructor(private deps: MemoryDeps) {}

  async initialize(context: MemoryContext): Promise<MemoryServices> {
    console.log('[MemoryServicesPlan] Initializing memory services...');

    // Get storage path from platform
    const memoryStoragePath = this.deps.getStoragePath();
    console.log('[MemoryServicesPlan] Memory storage path:', memoryStoragePath);

    // Step 1: Initialize Memory Storage Plan
    const memoryStoragePlan = await this.initializeMemoryStoragePlan(context, memoryStoragePath);

    // Step 2: Initialize File Storage Service
    const fileStorageService = await this.initializeFileStorageService(memoryStoragePath);

    // Step 3: Initialize Subject Plan
    const subjectPlan = await this.initializeSubjectPlan(fileStorageService);

    // Step 4: Initialize Chat Memory Plan
    const chatMemoryPlan = await this.initializeChatMemoryPlan(
      context,
      subjectPlan
    );

    console.log('[MemoryServicesPlan] ✅ All memory services initialized');

    return {
      memoryStoragePlan,
      fileStorageService,
      subjectPlan,
      chatMemoryPlan
    };
  }

  private async initializeMemoryStoragePlan(
    context: MemoryContext,
    memoryStoragePath: string
  ): Promise<any> {
    console.log('[MemoryServicesPlan] Initializing Memory Storage Plan...');

    // These imports are from lama.cube - should be refactored to be here
    const { MemoryStoragePlan } = await import('../../../lama.cube/main/services/memory-storage-plan.js');
    const { TopicAnalysisPlan } = await import('@lama/core/plans/TopicAnalysisPlan.js');

    const topicAnalysisPlan = new TopicAnalysisPlan(
      context.topicAnalysisModel,
      context.topicModel,
      context.llmManager,
      context.nodeOneCore
    );

    const memoryStoragePlan = new MemoryStoragePlan(
      context.nodeOneCore,
      topicAnalysisPlan,
      memoryStoragePath
    );

    // Start background indexing (non-blocking) using platform-specific scheduling
    this.deps.setImmediate(async () => {
      try {
        console.log('[MemoryServicesPlan] Scanning existing memories...');
        const result = await memoryStoragePlan.scanAndIndexExistingMemories();
        console.log(`[MemoryServicesPlan] Memory scan complete: ${result.scanned} files, ${result.indexed} indexed`);

        if (result.errors.length > 0) {
          console.warn('[MemoryServicesPlan] Memory scan errors:', result.errors);
        }
      } catch (error) {
        console.error('[MemoryServicesPlan] Error scanning memories:', error);
      }
    });

    console.log('[MemoryServicesPlan] ✅ Memory Storage Plan initialized');
    return memoryStoragePlan;
  }

  private async initializeFileStorageService(memoryStoragePath: string): Promise<any> {
    console.log('[MemoryServicesPlan] Initializing File Storage Service...');

    const { FileStorageService } = await import('@memory/storage');
    const { implode } = await import('@refinio/one.core/lib/microdata-imploder.js');
    const { explode } = await import('@refinio/one.core/lib/microdata-exploder.js');

    const memoryConfig = {
      basePath: memoryStoragePath,
      subfolders: {
        subjects: 'subjects'
      }
    };

    const fileStorageService = new FileStorageService(memoryConfig, {
      storeVersionedObject,
      implode,
      explode
    });

    await fileStorageService.initialize();
    console.log('[MemoryServicesPlan] ✅ File Storage Service initialized');

    return fileStorageService;
  }

  private async initializeSubjectPlan(fileStorageService: any): Promise<any> {
    console.log('[MemoryServicesPlan] Initializing Subject Plan...');

    const { SubjectPlan } = await import('@memory/storage');

    const subjectPlan = new SubjectPlan({
      storageService: fileStorageService
    });

    console.log('[MemoryServicesPlan] ✅ Subject Plan initialized');
    return subjectPlan;
  }

  private async initializeChatMemoryPlan(
    context: MemoryContext,
    subjectPlan: any
  ): Promise<any> {
    console.log('[MemoryServicesPlan] Initializing Chat Memory Plan...');

    const { MemoryPlan } = await import('@memory/core');
    const { ChatMemoryService } = await import('@memory/core');
    const { ChatMemoryPlan } = await import('@memory/core');

    // Create MemoryPlan wrapper
    const memoryPlan = new MemoryPlan(subjectPlan);
    console.log('[MemoryServicesPlan] ✅ Memory Plan created');

    // Create ChatMemoryService
    const chatMemoryService = new ChatMemoryService({
      nodeOneCore: context.nodeOneCore,
      topicAnalyzer: context.topicAnalysisModel,
      memoryPlan: memoryPlan,
      storeVersionedObject,
      getObjectByIdHash
    });
    console.log('[MemoryServicesPlan] ✅ Chat Memory Service created');

    // Create ChatMemoryPlan
    const chatMemoryPlan = new ChatMemoryPlan({
      chatMemoryService
    });
    console.log('[MemoryServicesPlan] ✅ Chat Memory Plan initialized');

    return chatMemoryPlan;
  }
}
