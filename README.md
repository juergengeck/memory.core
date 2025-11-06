# memory.core

Platform-agnostic memory management for LAMA.

## Features

- **ChatMemoryPlan**: Chat-memory integration layer
- **MemoryPlan**: Basic CRUD for SubjectAssembly objects
- **ChatMemoryService**: Core service for extracting subjects from chat messages
- **Keyword-based retrieval**: Find related memories using Jaccard similarity
- **ONE.core integration**: Stores memories as versioned objects

## Architecture

```
memory.core/
├── plans/              # Plan layer (thin API wrappers)
├── services/           # Core business logic
├── recipes/            # ONE.core recipe definitions
└── types/              # TypeScript type definitions
```

## Usage

### In lama.electron (Node.js)

```typescript
import { ChatMemoryPlan, ChatMemoryService } from '@memory.core';

const memoryService = new ChatMemoryService({ nodeOneCore });
const memoryPlan = new ChatMemoryPlan({ chatMemoryService });

// Enable memories for a topic
await memoryPlan.enableMemories(topicId);

// Extract subjects from messages
const result = await memoryPlan.extractSubjects({
  topicId,
  limit: 50
});

// Find related memories
const related = await memoryPlan.findRelatedMemories(
  topicId,
  ['keyword1', 'keyword2'],
  10
);
```

## Dependencies

- `@refinio/one.core` - Storage and versioning

## NO Platform Dependencies

This package is platform-agnostic and has NO dependencies on:
- Node.js APIs
- Electron APIs
- Browser APIs

All platform-specific integration happens in `lama.electron` or `lama.browser`.
