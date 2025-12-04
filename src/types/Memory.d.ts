/**
 * Memory - A constructed document synthesizing information from subjects
 *
 * Memory is a rich document containing both structured data and prose.
 * It is constructed from subjects and references them via sourceSubjects.
 * After construction, those subjects are updated to reference this memory.
 *
 * Identity: title + author (both isId: true in recipe)
 */
/**
 * Fact - An extracted assertion from source content
 */
export interface Fact {
    statement: string;
    confidence: number;
    sourceRef?: string;
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
    fromEntity: string;
    toEntity: string;
    relationType: string;
}
/**
 * Memory - The main document type
 */
export interface Memory {
    $type$: 'Memory';
    title: string;
    author: string;
    facts: Fact[];
    entities: Entity[];
    relationships: Relationship[];
    prose: string;
    sourceSubjects: string[];
}
