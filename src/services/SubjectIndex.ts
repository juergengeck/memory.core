/**
 * SubjectIndex
 *
 * In-memory index for fast keyword-based subject lookup.
 * Provides O(1) keyword → subjects mapping and Jaccard similarity search.
 *
 * This index is rebuilt on initialization and incrementally updated
 * when subjects are added/modified/removed.
 */

import type { SHA256IdHash } from '../types/one-core-types.js';

export interface SubjectIndexEntry {
  idHash: SHA256IdHash<any>;
  name: string;
  keywords: string[];
  normalizedKeywords: Set<string>; // Lowercase, no punctuation
  metadata?: Map<string, string>;
}

export interface SubjectMatch {
  idHash: SHA256IdHash<any>;
  name: string;
  keywords: string[];
  matchingKeywords: string[];
  relevanceScore: number; // 0.0 to 1.0 (Jaccard similarity)
}

export interface IndexStats {
  totalSubjects: number;
  totalKeywords: number;
  averageKeywordsPerSubject: number;
  memoryUsageBytes: number;
}

/**
 * SubjectIndex
 *
 * Fast in-memory index for subject lookups by keywords
 */
export class SubjectIndex {
  // keyword → Set of subject idHashes
  private keywordToSubjects: Map<string, Set<string>> = new Map();

  // idHash → subject entry
  private subjects: Map<string, SubjectIndexEntry> = new Map();

  constructor() {}

  /**
   * Add a subject to the index
   */
  addSubject(entry: SubjectIndexEntry): void {
    const idHashStr = String(entry.idHash);

    // Store subject entry
    this.subjects.set(idHashStr, entry);

    // Index keywords
    for (const keyword of entry.normalizedKeywords) {
      if (!this.keywordToSubjects.has(keyword)) {
        this.keywordToSubjects.set(keyword, new Set());
      }
      this.keywordToSubjects.get(keyword)!.add(idHashStr);
    }
  }

  /**
   * Remove a subject from the index
   */
  removeSubject(idHash: SHA256IdHash<any>): boolean {
    const idHashStr = String(idHash);
    const entry = this.subjects.get(idHashStr);

    if (!entry) {
      return false;
    }

    // Remove from keyword index
    for (const keyword of entry.normalizedKeywords) {
      const subjects = this.keywordToSubjects.get(keyword);
      if (subjects) {
        subjects.delete(idHashStr);
        // Clean up empty sets
        if (subjects.size === 0) {
          this.keywordToSubjects.delete(keyword);
        }
      }
    }

    // Remove subject entry
    this.subjects.delete(idHashStr);
    return true;
  }

  /**
   * Update a subject in the index
   * More efficient than remove + add when keywords haven't changed much
   */
  updateSubject(entry: SubjectIndexEntry): void {
    const idHashStr = String(entry.idHash);
    const oldEntry = this.subjects.get(idHashStr);

    if (!oldEntry) {
      // Subject doesn't exist, just add it
      this.addSubject(entry);
      return;
    }

    // Find keywords that were removed
    const removedKeywords = new Set(oldEntry.normalizedKeywords);
    for (const keyword of entry.normalizedKeywords) {
      removedKeywords.delete(keyword);
    }

    // Find keywords that were added
    const addedKeywords = new Set(entry.normalizedKeywords);
    for (const keyword of oldEntry.normalizedKeywords) {
      addedKeywords.delete(keyword);
    }

    // Update keyword index for removed keywords
    for (const keyword of removedKeywords) {
      const subjects = this.keywordToSubjects.get(keyword);
      if (subjects) {
        subjects.delete(idHashStr);
        if (subjects.size === 0) {
          this.keywordToSubjects.delete(keyword);
        }
      }
    }

    // Update keyword index for added keywords
    for (const keyword of addedKeywords) {
      if (!this.keywordToSubjects.has(keyword)) {
        this.keywordToSubjects.set(keyword, new Set());
      }
      this.keywordToSubjects.get(keyword)!.add(idHashStr);
    }

    // Update subject entry
    this.subjects.set(idHashStr, entry);
  }

  /**
   * Find subjects by exact keyword match
   * Returns all subjects that have at least one matching keyword
   */
  findByKeywords(keywords: string[]): SubjectMatch[] {
    const normalizedKeywords = this.normalizeKeywords(keywords);
    const candidateIdHashes = new Set<string>();

    // Find all subjects that match any keyword
    for (const keyword of normalizedKeywords) {
      const subjects = this.keywordToSubjects.get(keyword);
      if (subjects) {
        for (const idHash of subjects) {
          candidateIdHashes.add(idHash);
        }
      }
    }

    // Calculate relevance scores for each candidate
    const matches: SubjectMatch[] = [];
    const searchKeywordSet = new Set(normalizedKeywords);

    for (const idHashStr of candidateIdHashes) {
      const entry = this.subjects.get(idHashStr);
      if (!entry) continue;

      const matchingKeywords = this.findMatchingKeywords(
        searchKeywordSet,
        entry.normalizedKeywords
      );

      if (matchingKeywords.length > 0) {
        const relevanceScore = this.calculateJaccardSimilarity(
          searchKeywordSet,
          entry.normalizedKeywords
        );

        matches.push({
          idHash: entry.idHash,
          name: entry.name,
          keywords: entry.keywords,
          matchingKeywords,
          relevanceScore
        });
      }
    }

    // Sort by relevance (highest first)
    matches.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return matches;
  }

  /**
   * Find similar subjects using Jaccard similarity
   * Returns top N most similar subjects, sorted by relevance
   */
  findSimilar(keywords: string[], limit: number = 10): SubjectMatch[] {
    const matches = this.findByKeywords(keywords);
    return matches.slice(0, limit);
  }

  /**
   * Get a subject entry by idHash
   */
  getSubject(idHash: SHA256IdHash<any>): SubjectIndexEntry | null {
    return this.subjects.get(String(idHash)) || null;
  }

  /**
   * Check if a subject exists in the index
   */
  hasSubject(idHash: SHA256IdHash<any>): boolean {
    return this.subjects.has(String(idHash));
  }

  /**
   * Get all subjects in the index
   */
  getAllSubjects(): SubjectIndexEntry[] {
    return Array.from(this.subjects.values());
  }

  /**
   * Clear the entire index
   */
  clear(): void {
    this.subjects.clear();
    this.keywordToSubjects.clear();
  }

  /**
   * Get index statistics
   */
  getStats(): IndexStats {
    let totalKeywords = 0;
    for (const entry of this.subjects.values()) {
      totalKeywords += entry.normalizedKeywords.size;
    }

    // Rough memory usage estimate (not exact)
    const memoryUsageBytes =
      this.subjects.size * 500 + // Approximate per-subject overhead
      this.keywordToSubjects.size * 100; // Approximate per-keyword overhead

    return {
      totalSubjects: this.subjects.size,
      totalKeywords: this.keywordToSubjects.size,
      averageKeywordsPerSubject: this.subjects.size > 0
        ? totalKeywords / this.subjects.size
        : 0,
      memoryUsageBytes
    };
  }

  /**
   * Normalize keywords for consistent matching
   * - Lowercase
   * - Remove punctuation
   * - Trim whitespace
   */
  private normalizeKeywords(keywords: string[]): string[] {
    return keywords.map(kw => this.normalizeKeyword(kw));
  }

  private normalizeKeyword(keyword: string): string {
    return String(keyword)
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .trim();
  }

  /**
   * Find matching keywords between search keywords and subject keywords
   */
  private findMatchingKeywords(
    searchKeywords: Set<string>,
    subjectKeywords: Set<string>
  ): string[] {
    const matches: string[] = [];

    for (const keyword of searchKeywords) {
      if (subjectKeywords.has(keyword)) {
        matches.push(keyword);
      } else {
        // Check for partial matches (substring)
        for (const subjectKw of subjectKeywords) {
          if (subjectKw.includes(keyword) || keyword.includes(subjectKw)) {
            matches.push(keyword);
            break;
          }
        }
      }
    }

    return matches;
  }

  /**
   * Calculate Jaccard similarity coefficient
   * J(A, B) = |A ∩ B| / |A ∪ B|
   *
   * Returns value between 0.0 (no similarity) and 1.0 (identical)
   */
  private calculateJaccardSimilarity(
    setA: Set<string>,
    setB: Set<string>
  ): number {
    // Intersection
    const intersection = new Set<string>();
    for (const item of setA) {
      if (setB.has(item)) {
        intersection.add(item);
      }
    }

    // Union
    const union = new Set<string>([...setA, ...setB]);

    // Handle edge case: both sets empty
    if (union.size === 0) {
      return 0.0;
    }

    return intersection.size / union.size;
  }

  /**
   * Build index from a list of subjects
   * More efficient than adding one by one
   */
  buildFromSubjects(entries: SubjectIndexEntry[]): void {
    this.clear();

    for (const entry of entries) {
      this.addSubject(entry);
    }
  }

  /**
   * Export index state (for debugging/persistence)
   */
  exportState(): {
    subjects: SubjectIndexEntry[];
    keywordIndex: Record<string, string[]>;
  } {
    const keywordIndex: Record<string, string[]> = {};
    for (const [keyword, subjects] of this.keywordToSubjects) {
      keywordIndex[keyword] = Array.from(subjects);
    }

    return {
      subjects: Array.from(this.subjects.values()),
      keywordIndex
    };
  }
}

/**
 * Helper function to create SubjectIndexEntry from SubjectAssembly
 */
export function createIndexEntry(subject: {
  idHash: SHA256IdHash<any>;
  name: string;
  keywords?: string[];
  metadata?: Map<string, string>;
}): SubjectIndexEntry {
  const keywords = subject.keywords || [];
  const normalizedKeywords = new Set(
    keywords.map(kw =>
      String(kw)
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .trim()
    )
  );

  return {
    idHash: subject.idHash,
    name: subject.name,
    keywords,
    normalizedKeywords,
    metadata: subject.metadata
  };
}
