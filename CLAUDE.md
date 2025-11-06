# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`memory.core` is a platform-agnostic memory management package for the LAMA system. It provides chat-memory integration using ONE.core for storage and versioning. This package has NO platform dependencies (Node.js, Electron, Browser) - all platform-specific integration happens in consuming packages like `lama.electron` or `lama.browser`.

## Commands

```bash
# Build the package
npm run build

# Watch mode (rebuilds on file changes)
npm run watch

# Clean build artifacts
npm run clean
```

Note: There are no test or lint commands configured in this package.

## Architecture

### Layer Structure

The codebase follows a clean 3-layer architecture:

```
plans/       → Thin API wrappers, user-facing methods
services/    → Core business logic, platform-agnostic algorithms
recipes/     → ONE.core schema definitions for versioned objects
types/       → TypeScript type definitions
```

**Key principle**: Services contain all business logic. Plans are simple delegators to services.

### Core Components

**ChatMemoryService** (`services/ChatMemoryService.ts`)
- Main service for extracting subjects from chat messages
- Uses Jaccard similarity for keyword-based memory retrieval
- Stores memories as SubjectAssembly objects via MemoryPlan
- Manages ChatMemoryConfig and ChatMemoryAssociation objects
- Dependencies injected via constructor (nodeOneCore, topicAnalyzer, memoryPlan, etc.)

**ChatMemoryPlan** (`plans/ChatMemoryPlan.ts`)
- User-facing API for chat-memory operations
- Methods: enableMemories, extractSubjects, findRelatedMemories, updateMemoryFromChat
- Pure delegation to ChatMemoryService - no business logic

**MemoryPlan** (`plans/MemoryPlan.ts`)
- CRUD operations for SubjectAssembly objects
- Wraps ONE.core storage operations

### Dependency Injection Pattern

All services and plans use constructor-based dependency injection:

```typescript
export interface ChatMemoryServiceDependencies {
  nodeOneCore: any;
  topicAnalyzer?: any;
  memoryPlan?: any;
  storeVersionedObject?: any;
  getObjectByIdHash?: any;
}

export class ChatMemoryService {
  constructor(private deps: ChatMemoryServiceDependencies) {}
}
```

This pattern enables platform-agnostic code - consuming packages inject platform-specific implementations.

### Key Data Flows

1. **Memory Extraction**: Chat messages → TopicAnalyzer.extractKeywords → ExtractedSubject → SubjectAssembly (via MemoryPlan)
2. **Memory Retrieval**: Keywords → Jaccard similarity calculation → Ranked RelatedMemory results
3. **Memory Updates**: Existing subject + new keywords → Merged keywords → Updated SubjectAssembly

### ONE.core Integration

- All persistent objects are versioned using ONE.core's storeVersionedObject
- ChatMemoryConfig: Configuration per chat topic (topicId as ID)
- ChatMemoryAssociation: Links between topics and memory subjects
- SubjectAssembly: Actual memory objects (managed by MemoryPlan)

## Module System

- ES modules with `.js` extensions in imports (TypeScript outputs to .js)
- Package exports configured for specific subpaths (plans/*, services/*, types/*, etc.)
- All imports from ONE.core use full paths: `@refinio/one.core/lib/util/type-checks.js`

## Important Notes

- SHA256Hash and SHA256IdHash are branded string types from ONE.core - they're just strings with type safety
- No fallbacks or mitigations - fail fast and throw errors
- TypeScript strict mode is disabled (strict: false) - this is intentional for rapid prototyping
- The initialization/ directory exists but MemoryServicesPlan is not exported (see TODO in index.ts:13)
