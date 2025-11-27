/**
 * MemoryPlan - CRUD operations for Memory objects
 *
 * Handles creation, retrieval, and updates of Memory documents.
 * After creating a Memory, updates source subjects to reference it.
 */

import type { Memory, Fact, Entity, Relationship } from '../types/Memory.js';

export interface MemoryPlanDependencies {
    storeVersionedObject: (obj: any) => Promise<{ idHash: string; hash: string }>;
    getObjectByIdHash: (idHash: string) => Promise<{ obj: any } | undefined>;
    getInstanceOwner: () => Promise<string>;  // Returns Person IdHash
    subjectsPlan: {
        addMemoryToSubject: (subjectIdHash: string, memoryIdHash: string) => Promise<void>;
    };
}

export class MemoryPlan {
    constructor(private deps: MemoryPlanDependencies) {}

    /**
     * Create a new Memory from subjects
     */
    async createMemory(params: {
        title: string;
        sourceSubjects: string[];
        facts: Fact[];
        entities: Entity[];
        relationships: Relationship[];
        prose: string;
    }): Promise<{ idHash: string; memory: Memory }> {
        const author = await this.deps.getInstanceOwner();

        const memory: Memory = {
            $type$: 'Memory',
            title: params.title,
            author,
            facts: params.facts,
            entities: params.entities,
            relationships: params.relationships,
            prose: params.prose,
            sourceSubjects: params.sourceSubjects
        };

        const result = await this.deps.storeVersionedObject(memory);

        // Update all source subjects to reference this memory
        for (const subjectIdHash of params.sourceSubjects) {
            await this.deps.subjectsPlan.addMemoryToSubject(subjectIdHash, result.idHash);
        }

        return { idHash: result.idHash, memory };
    }

    /**
     * Get a Memory by IdHash
     */
    async getMemory(idHash: string): Promise<Memory | undefined> {
        const result = await this.deps.getObjectByIdHash(idHash);
        return result?.obj as Memory | undefined;
    }

    /**
     * List all memories (basic implementation)
     */
    async listMemories(): Promise<Memory[]> {
        // This would need a proper implementation using ONE.core queries
        // For now, return empty - actual implementation depends on storage layer
        return [];
    }
}
