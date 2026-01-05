/**
 * MemoryPlan - CRUD operations for Memory objects
 *
 * Handles creation, retrieval, and updates of Memory documents.
 * After creating a Memory, updates source subjects to reference it.
 */

import type { Memory, Fact, Entity, Relationship } from '../types/Memory.js';
import type { EmbeddingModel } from '@cube/meaning.core';

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
        // New fields
        summary?: string;
        relatedSubjects?: string[];
        embedding?: number[];
        embeddingModel?: EmbeddingModel;
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
            sourceSubjects: params.sourceSubjects,
            // New fields
            summary: params.summary,
            relatedSubjects: params.relatedSubjects,
            embedding: params.embedding,
            embeddingModel: params.embeddingModel
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
     * Update a Memory with new fields
     */
    async updateMemory(params: {
        idHash: string;
        updates: {
            summary?: string;
            relatedSubjects?: string[];
            embedding?: number[];
            embeddingModel?: EmbeddingModel;
        };
    }): Promise<{ idHash: string; memory: Memory }> {
        const existing = await this.getMemory(params.idHash);
        if (!existing) {
            throw new Error(`Memory not found: ${params.idHash}`);
        }

        const updated: Memory = {
            ...existing,
            summary: params.updates.summary ?? existing.summary,
            relatedSubjects: params.updates.relatedSubjects ?? existing.relatedSubjects,
            embedding: params.updates.embedding ?? existing.embedding,
            embeddingModel: params.updates.embeddingModel ?? existing.embeddingModel
        };

        const result = await this.deps.storeVersionedObject(updated);
        return { idHash: result.idHash, memory: updated };
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
