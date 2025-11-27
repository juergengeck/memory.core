/**
 * Memory - A constructed document synthesizing information from subjects
 *
 * Memory is a rich document containing both structured data and prose.
 * It is constructed from subjects and references them via sourceSubjects.
 * After construction, those subjects are updated to reference this memory.
 *
 * Identity: title + author (both isId: true in recipe)
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';

/**
 * Fact - An extracted assertion from source content
 */
export interface Fact {
    statement: string;
    confidence: number;  // 0.0 to 1.0
    sourceRef?: string;  // Reference to source message/document
}

/**
 * Entity - A person, place, thing, or concept
 */
export interface Entity {
    name: string;
    type: 'person' | 'place' | 'thing' | 'concept' | 'event';
    description?: string;
}

/**
 * Relationship - Connection between entities
 */
export interface Relationship {
    fromEntity: string;  // Entity name
    toEntity: string;    // Entity name
    relationType: string;  // e.g., "works at", "located in", "caused by"
}

/**
 * Memory - The main document type
 */
export interface Memory {
    $type$: 'Memory';

    // Identity (isId: true)
    title: string;
    author: string;  // SHA256IdHash<Person> - instance owner when creating

    // Structured content
    facts: Fact[];
    entities: Entity[];
    relationships: Relationship[];

    // Prose content
    prose: string;  // Synthesized narrative (markdown)

    // Source subjects this memory was constructed from
    sourceSubjects: string[];  // Array of SHA256IdHash<Subject>
}
