/**
 * memory.core - Platform-agnostic memory management
 *
 * Provides chat memory extraction, storage, and retrieval
 * for the LAMA system using ONE.core.
 *
 * Architecture:
 * - Subject (lama.core) - Source of truth for conversation themes
 * - Memory (memory.core) - Wraps Subject with display/access metadata
 * - SubjectsPlan (lama.core) - CRUD for subjects
 * - MemoryPlan (memory.core) - Memory-specific operations
 */

// Plans
export * from './plans/ChatMemoryPlan.js';
export * from './plans/MemoryPlan.js';
export * from './plans/MemoryImportPlan.js';
export * from './plans/MemoryExportPlan.js';
export * from './plans/SubjectMemoryPlan.js';

// Initialization
// NOTE: Subject management now uses lama.core's SubjectsPlan directly.
// The Subject type from lama.core is the source of truth.
// memory.core should adapt to use lama.core's Subject type.
// See: lama.core/plans/SubjectsPlan.ts
// export * from './initialization/MemoryServicesPlan.js';

// Services
export * from './services/ChatMemoryService.js';
export * from './services/SubjectIndex.js';

// Migration
export * from './migration/index.js';

// Types
export * from './types/chat-memory-types.js';
export * from './types/Memory.js';

// Recipes
export * from './recipes/ChatMemoryConfig.js';
export * from './recipes/MemoryRecipe.js';
