/**
 * memory.core - Platform-agnostic memory management
 *
 * Provides chat memory extraction, storage, and retrieval
 * for the LAMA system using ONE.core.
 */

// Plans
export * from './plans/ChatMemoryPlan.js';
export * from './plans/MemoryPlan.js';

// Initialization
// TODO: Fix MemoryServicesPlan imports - needs dependency injection like AIInitializationPlan
// export * from './initialization/MemoryServicesPlan.js';

// Services
export * from './services/ChatMemoryService.js';
export * from './services/SubjectIndex.js';

// Migration
export * from './migration/index.js';

// Types
export * from './types/chat-memory-types.js';

// Recipes
export * from './recipes/ChatMemoryConfig.js';
