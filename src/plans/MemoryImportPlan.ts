/**
 * MemoryImportPlan - Import portable memory documents
 *
 * Imports self-contained HTML memory documents with:
 * - Signature verification
 * - Trust evaluation via TrustedKeysManager
 * - Profile creation for unknown signers (with user prompt)
 * - Audit trail integration
 *
 * Uses existing types: Profile, TrustStatus, AuditEvent
 * Returns the Memory via explode() - no wrapper types.
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { AnyObjectCreation } from '@refinio/one.core/lib/storage-base-common.js';

/**
 * Trust status type (matches trust.core)
 */
type TrustStatus = 'trusted' | 'untrusted' | 'pending' | 'revoked';

/**
 * Embedded signature data extracted from HTML
 */
interface EmbeddedSignatureData {
    signature: string;
    signingKey: string;
    personId: SHA256IdHash<Person>;
    signedAt: number;
}

/**
 * Profile type (simplified - actual type from one.models)
 */
interface Profile {
    $type$: 'Profile';
    personId: SHA256IdHash<Person>;
    [key: string]: unknown;
}

/**
 * TrustedKeysManager interface (subset we need)
 */
interface TrustedKeysManager {
    getKeyTrustInfo(key: string): Promise<{ trusted: boolean; reason: string }>;
}

/**
 * AuditTrailService interface (subset we need)
 */
interface AuditTrailService {
    recordEvent(event: {
        eventType: string;
        actor: SHA256IdHash<Person>;
        subject?: SHA256IdHash<Person> | string;
        success: boolean;
        error?: string;
        reason?: string;
        metadata?: Record<string, unknown>;
    }): Promise<void>;
}

/**
 * LeuteModel interface (subset we need)
 */
interface LeuteModel {
    myMainIdentity(): Promise<SHA256IdHash<Person>>;
    others(): Promise<Array<{ identities(): SHA256IdHash<Person>[] }>>;
    addOther?(personId: SHA256IdHash<Person>, options: {
        profileHash: SHA256Hash;
        source: string;
        trustStatus: TrustStatus;
    }): Promise<void>;
}

/**
 * Dependencies injected into MemoryImportPlan
 */
export interface MemoryImportDependencies {
    /**
     * Explode function from one.core - restores objects from HTML microdata
     */
    explode: (html: string, expectedType?: string | string[]) => Promise<AnyObjectCreation>;

    /**
     * Store versioned object (for profile storage)
     */
    storeVersionedObject: (obj: unknown) => Promise<{ hash: SHA256Hash; idHash: SHA256IdHash<any> }>;

    /**
     * TrustedKeysManager for trust evaluation
     */
    trustedKeysManager: TrustedKeysManager;

    /**
     * AuditTrailService for recording import events
     */
    auditService: AuditTrailService;

    /**
     * LeuteModel for contact management
     */
    leuteModel: LeuteModel;

    /**
     * Callback when signer is unknown - returns true to proceed with import
     */
    onUnknownSigner: (profile: Profile, personId: SHA256IdHash<Person>) => Promise<boolean>;
}

/**
 * MemoryImportPlan - Import portable memory documents
 */
export class MemoryImportPlan {
    constructor(private deps: MemoryImportDependencies) {}

    /**
     * Import a portable memory document.
     *
     * Flow:
     * 1. Extract signature, profile from HTML metadata
     * 2. Verify signature cryptographically
     * 3. Evaluate trust via TrustedKeysManager
     * 4. Prompt user if unknown signer
     * 5. Create profile for unknown signer if approved
     * 6. Call explode() to restore Memory
     * 7. Record audit event
     *
     * @param html - The portable HTML memory document
     * @returns The Memory object creation result (hash, idHash)
     * @throws Error if signature is invalid or user rejects unknown signer
     */
    async importMemory(html: string): Promise<AnyObjectCreation> {
        const myIdentity = await this.deps.leuteModel.myMainIdentity();

        // 1. Extract embedded signature and profile from HTML metadata
        const signatureData = this.extractSignatureData(html);
        const embeddedProfile = this.extractEmbeddedProfile(html);
        const contentHtml = this.stripVerificationMetadata(html);

        // 2. Verify signature (if present)
        let signatureValid = false;
        let signerPersonId: SHA256IdHash<Person> | undefined;

        if (signatureData) {
            signatureValid = await this.verifySignature(
                contentHtml,
                signatureData.signature,
                signatureData.signingKey
            );

            if (!signatureValid) {
                await this.deps.auditService.recordEvent({
                    eventType: 'memory_imported',
                    actor: myIdentity,
                    success: false,
                    error: 'Invalid signature',
                    metadata: { signingKey: signatureData.signingKey }
                });
                throw new Error('Signature verification failed');
            }

            signerPersonId = signatureData.personId;
        }

        // 3. Evaluate trust
        let trustStatus: TrustStatus = 'untrusted';

        if (signatureData && signatureValid) {
            const keyTrustInfo = await this.deps.trustedKeysManager.getKeyTrustInfo(
                signatureData.signingKey
            );

            if (keyTrustInfo.trusted) {
                trustStatus = 'trusted';
            } else if (embeddedProfile && signerPersonId) {
                // Unknown signer - prompt user
                const userApproved = await this.deps.onUnknownSigner(
                    embeddedProfile,
                    signerPersonId
                );

                if (!userApproved) {
                    await this.deps.auditService.recordEvent({
                        eventType: 'memory_imported',
                        actor: myIdentity,
                        subject: signerPersonId,
                        success: false,
                        error: 'User rejected unknown signer'
                    });
                    throw new Error('Import rejected by user');
                }

                // Create profile for unknown signer (untrusted by default)
                await this.createProfileForSigner(embeddedProfile, signerPersonId, myIdentity);
                trustStatus = 'untrusted'; // User can elevate later
            }
        }

        // 4. Import via explode
        const result = await this.deps.explode(contentHtml, 'Memory');

        // 5. Record audit event
        await this.deps.auditService.recordEvent({
            eventType: 'memory_imported',
            actor: myIdentity,
            subject: signerPersonId,
            success: true,
            metadata: {
                memoryHash: result.hash,
                memoryIdHash: result.idHash,
                trustStatus,
                signed: !!signatureData,
                signatureValid
            }
        });

        return result;
    }

    /**
     * Extract signature data from HTML document.
     * Looks for <meta itemprop="signatureData" content="..."> in document.
     */
    private extractSignatureData(html: string): EmbeddedSignatureData | undefined {
        const match = html.match(/<meta\s+itemprop="signatureData"\s+content="([^"]+)"/);
        if (!match) return undefined;

        try {
            const decoded = JSON.parse(this.unescapeHtml(match[1]));
            return {
                signature: decoded.signature,
                signingKey: decoded.signingKey,
                personId: decoded.personId as SHA256IdHash<Person>,
                signedAt: decoded.signedAt
            };
        } catch {
            return undefined;
        }
    }

    /**
     * Extract embedded profile from HTML document.
     * The profile is imploded as a nested microdata object.
     */
    private extractEmbeddedProfile(html: string): Profile | undefined {
        // Match the signerProfile div and its content
        const match = html.match(
            /<div\s+itemprop="signerProfile"[^>]*>([\s\S]*?)<\/div>(?=\s*<(?:meta|div\s+itemprop="|\/div>))/
        );
        if (!match) return undefined;

        try {
            // Parse microdata to object without storing
            const profileHtml = match[1];
            return this.parseMicrodataToProfile(profileHtml);
        } catch {
            return undefined;
        }
    }

    /**
     * Strip verification metadata, leaving only the Memory content.
     * This is the content that was signed.
     */
    private stripVerificationMetadata(html: string): string {
        return html
            .replace(/<meta\s+itemprop="signatureData"[^>]*>/g, '')
            .replace(/<div\s+itemprop="signerProfile"[^>]*>[\s\S]*?<\/div>(?=\s*<(?:meta|div\s+itemprop="|\/div>))/g, '')
            .replace(/<div\s+itemprop="certificateChain"[^>]*>[\s\S]*?<\/div>/g, '');
    }

    /**
     * Verify signature against content hash.
     */
    private async verifySignature(
        contentHtml: string,
        signature: string,
        signingKey: string
    ): Promise<boolean> {
        try {
            const { signatureVerify, ensurePublicSignKey } = await import(
                '@refinio/one.core/lib/crypto/sign.js'
            );
            const { hexToUint8ArrayWithCheck } = await import(
                '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js'
            );
            const { createCryptoHash } = await import(
                '@refinio/one.core/lib/system/crypto-helpers.js'
            );

            // Calculate hash of content
            const contentHash = await createCryptoHash(contentHtml);

            // Convert hex strings to Uint8Array (hexToUint8ArrayWithCheck validates input)
            const publicKey = ensurePublicSignKey(hexToUint8ArrayWithCheck(signingKey));
            const signatureBytes = hexToUint8ArrayWithCheck(signature);

            // Verify: signature was created over the hash bytes (hash is already hex string)
            return signatureVerify(
                hexToUint8ArrayWithCheck(contentHash),
                signatureBytes,
                publicKey
            );
        } catch (err) {
            console.error('[MemoryImportPlan] Signature verification error:', err);
            return false;
        }
    }

    /**
     * Create a profile for an unknown signer.
     * Uses LeuteModel to add as a new contact with untrusted status.
     */
    private async createProfileForSigner(
        embeddedProfile: Profile,
        signerPersonId: SHA256IdHash<Person>,
        myIdentity: SHA256IdHash<Person>
    ): Promise<void> {
        // Check if we already have this person
        const existingOthers = await this.deps.leuteModel.others();
        const alreadyKnown = existingOthers.some(
            someone => someone.identities().includes(signerPersonId)
        );

        if (alreadyKnown) {
            return;
        }

        // Store the embedded profile
        const profileResult = await this.deps.storeVersionedObject(embeddedProfile);

        // Add as contact if LeuteModel supports it
        if (this.deps.leuteModel.addOther) {
            await this.deps.leuteModel.addOther(signerPersonId, {
                profileHash: profileResult.hash,
                source: 'memory_import',
                trustStatus: 'untrusted'
            });
        }

        // Record audit event for contact creation
        await this.deps.auditService.recordEvent({
            eventType: 'trust_established',
            actor: myIdentity,
            subject: signerPersonId,
            success: true,
            reason: 'Contact created from memory import',
            metadata: {
                profileHash: profileResult.hash,
                trustStatus: 'untrusted',
                source: 'memory_import'
            }
        });
    }

    /**
     * Parse microdata HTML to Profile object (without storing).
     * Simplified parser - extracts key fields from microdata structure.
     */
    private parseMicrodataToProfile(html: string): Profile | undefined {
        // Extract $type$
        const typeMatch = html.match(/itemtype="[^"]*\/([^"]+)"/);
        if (!typeMatch || typeMatch[1] !== 'Profile') {
            return undefined;
        }

        // Extract personId
        const personIdMatch = html.match(/<span\s+itemprop="personId"[^>]*>([^<]+)<\/span>/);
        if (!personIdMatch) {
            return undefined;
        }

        return {
            $type$: 'Profile',
            personId: personIdMatch[1] as SHA256IdHash<Person>
        };
    }

    /**
     * Unescape HTML entities in metadata
     */
    private unescapeHtml(html: string): string {
        return html
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }
}
