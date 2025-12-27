/**
 * MemoryExportPlan - Export memories as portable HTML documents
 *
 * Creates self-contained HTML memory documents with:
 * - Signature for authenticity
 * - Embedded signer profile
 * - Certificate chain for offline verification
 * - Optional resolution of external URLs to embedded BLOBs
 *
 * Uses existing types: Profile, TrustKeysCertificate
 * Uses one.core implode() for HTML serialization.
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';

/**
 * Signature result from signing content
 */
interface SignatureResult {
    signature: string;  // Hex-encoded Ed25519 signature
    signingKey: string; // Hex-encoded public sign key
}

/**
 * CryptoApi subset we need for signing
 */
interface CryptoApi {
    sign(data: Uint8Array): Uint8Array;
    readonly publicSignKey: Uint8Array;
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
 * Profile hash lookup interface
 */
interface ProfileInfo {
    hash: SHA256Hash;
}

/**
 * LeuteModel interface (subset we need for export)
 */
interface LeuteModel {
    myMainIdentity(): Promise<SHA256IdHash<Person>>;
    me(): Promise<{
        profiles(): ProfileInfo[];
    }>;
}

/**
 * Export options
 */
export interface ExportOptions {
    /** Sign the document (default: true) */
    sign?: boolean;
    /** Include signer profile (default: true) */
    embedProfile?: boolean;
    /** Include certificate chain (default: true) */
    embedCertificateChain?: boolean;
    /** Convert URL references to embedded BLOBs (default: false) */
    resolveExternalUrls?: boolean;
}

/**
 * BLOB storage result
 */
interface BlobResult {
    hash: SHA256Hash;
}

/**
 * Dependencies injected into MemoryExportPlan
 */
export interface MemoryExportDependencies {
    /**
     * Implode function from one.core - creates self-contained HTML from objects
     */
    implode: (hash: SHA256Hash) => Promise<string>;

    /**
     * LeuteModel for identity and profile access
     */
    leuteModel: LeuteModel;

    /**
     * AuditTrailService for recording export events
     */
    auditService: AuditTrailService;

    /**
     * Create CryptoApi for signing (from keychain)
     */
    createCryptoApi: (owner: SHA256IdHash<Person>) => Promise<CryptoApi>;

    /**
     * Get certificate hashes for a person (optional - for embedding cert chain)
     */
    getCertificateHashes?: (personId: SHA256IdHash<Person>) => Promise<SHA256Hash[]>;

    /**
     * Read file content (optional - for resolving external URLs)
     * Platform-specific: provide on Node.js/Electron, omit on browser
     */
    readFile?: (path: string) => Promise<Uint8Array>;

    /**
     * Store BLOB content (optional - for resolving external URLs)
     */
    storeBlob?: (content: Uint8Array) => Promise<BlobResult>;
}

/**
 * MemoryExportPlan - Export memories as portable HTML documents
 */
export class MemoryExportPlan {
    constructor(private deps: MemoryExportDependencies) {}

    /**
     * Export a memory as a portable HTML document.
     *
     * Flow:
     * 1. Get base imploded HTML via implode()
     * 2. Optionally resolve external URLs to embedded BLOBs
     * 3. Sign the content
     * 4. Embed signer profile
     * 5. Embed certificate chain
     * 6. Wrap with verification metadata
     * 7. Record audit event
     *
     * @param memoryHash - Hash of the Memory object to export
     * @param options - Export options
     * @returns Portable HTML document string
     */
    async exportMemory(
        memoryHash: SHA256Hash,
        options: ExportOptions = {}
    ): Promise<string> {
        const {
            sign = true,
            embedProfile = true,
            embedCertificateChain = true,
            resolveExternalUrls = false
        } = options;

        const myIdentity = await this.deps.leuteModel.myMainIdentity();

        // 1. Get base imploded HTML
        let html = await this.deps.implode(memoryHash);

        // 2. Optionally resolve external URLs to embedded BLOBs
        if (resolveExternalUrls) {
            html = await this.resolveUrlsToBlobs(html);
        }

        // 3. Sign the content
        let signatureData: string | undefined;
        if (sign) {
            const { signature, signingKey } = await this.signContent(html, myIdentity);

            signatureData = JSON.stringify({
                signature,
                signingKey,
                personId: myIdentity,
                signedAt: Date.now()
            });
        }

        // 4. Get signer profile
        let profileHtml: string | undefined;
        if (embedProfile) {
            profileHtml = await this.getImplodedProfile(myIdentity);
        }

        // 5. Get certificate chain
        let certChainHtml: string | undefined;
        if (embedCertificateChain && this.deps.getCertificateHashes) {
            certChainHtml = await this.getImplodedCertificateChain(myIdentity);
        }

        // 6. Wrap with verification metadata
        const exportedHtml = this.wrapWithMetadata(html, {
            signatureData,
            profileHtml,
            certChainHtml
        });

        // 7. Record audit event
        await this.deps.auditService.recordEvent({
            eventType: 'memory_exported',
            actor: myIdentity,
            success: true,
            metadata: {
                memoryHash,
                signed: sign,
                profileEmbedded: embedProfile,
                certChainEmbedded: embedCertificateChain && !!certChainHtml,
                urlsResolved: resolveExternalUrls
            }
        });

        return exportedHtml;
    }

    /**
     * Sign content using the person's signing key.
     * Signs the SHA256 hash of the content.
     */
    private async signContent(
        content: string,
        personId: SHA256IdHash<Person>
    ): Promise<SignatureResult> {
        const { createCryptoHash } = await import(
            '@refinio/one.core/lib/system/crypto-helpers.js'
        );
        const { uint8arrayToHexString, hexToUint8ArrayWithCheck } = await import(
            '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js'
        );

        const cryptoApi = await this.deps.createCryptoApi(personId);

        // Calculate hash of content
        const contentHash = await createCryptoHash(content);

        // Sign the hash bytes
        const hashBytes = hexToUint8ArrayWithCheck(contentHash);
        const signatureBytes = cryptoApi.sign(hashBytes);

        return {
            signature: uint8arrayToHexString(signatureBytes),
            signingKey: uint8arrayToHexString(cryptoApi.publicSignKey)
        };
    }

    /**
     * Resolve file:// URLs in the HTML to embedded BLOBs.
     * This makes the document self-contained.
     * Requires readFile and storeBlob dependencies to be provided.
     */
    private async resolveUrlsToBlobs(html: string): Promise<string> {
        // Check if dependencies are available
        if (!this.deps.readFile || !this.deps.storeBlob) {
            console.warn('[MemoryExportPlan] readFile/storeBlob not provided, skipping URL resolution');
            return html;
        }

        // Match file:// URLs in href attributes
        const urlPattern = /<a\s+[^>]*href="(file:\/\/[^"]+)"[^>]*>([^<]*)<\/a>/g;
        const matches = [...html.matchAll(urlPattern)];

        if (matches.length === 0) {
            return html;
        }

        let result = html;

        for (const match of matches) {
            const fullMatch = match[0];
            const fileUrl = match[1];
            const filePath = fileUrl.replace('file://', '');

            try {
                const content = await this.deps.readFile(filePath);
                const blobResult = await this.deps.storeBlob(content);

                // Replace with BLOB reference
                const blobRef = `<a data-type="blob" href="${blobResult.hash}">${blobResult.hash}</a>`;
                result = result.replace(fullMatch, blobRef);
            } catch (err) {
                console.warn(`[MemoryExportPlan] Could not resolve external file: ${filePath}`, err);
                // Leave the original URL in place
            }
        }

        return result;
    }

    /**
     * Get the imploded profile HTML for embedding.
     */
    private async getImplodedProfile(personId: SHA256IdHash<Person>): Promise<string | undefined> {
        try {
            const me = await this.deps.leuteModel.me();
            const profiles = me.profiles();

            if (profiles.length === 0) {
                console.warn('[MemoryExportPlan] No profile found for signer');
                return undefined;
            }

            const profileHash = profiles[0].hash;
            return await this.deps.implode(profileHash);
        } catch (err) {
            console.warn('[MemoryExportPlan] Could not get profile:', err);
            return undefined;
        }
    }

    /**
     * Get the imploded certificate chain HTML for embedding.
     */
    private async getImplodedCertificateChain(
        personId: SHA256IdHash<Person>
    ): Promise<string | undefined> {
        if (!this.deps.getCertificateHashes) {
            return undefined;
        }

        try {
            const certHashes = await this.deps.getCertificateHashes(personId);

            if (certHashes.length === 0) {
                return undefined;
            }

            const implodedCerts: string[] = [];
            for (const certHash of certHashes) {
                const imploded = await this.deps.implode(certHash);
                implodedCerts.push(imploded);
            }

            return implodedCerts.join('');
        } catch (err) {
            console.warn('[MemoryExportPlan] Could not get certificate chain:', err);
            return undefined;
        }
    }

    /**
     * Wrap content HTML with verification metadata.
     * Inserts metadata before the closing </div> tag.
     */
    private wrapWithMetadata(
        contentHtml: string,
        metadata: {
            signatureData?: string;
            profileHtml?: string;
            certChainHtml?: string;
        }
    ): string {
        const { signatureData, profileHtml, certChainHtml } = metadata;

        // Find the last closing </div> tag to insert metadata before it
        const insertionPoint = contentHtml.lastIndexOf('</div>');

        if (insertionPoint === -1) {
            // No closing div found, append metadata at the end
            return contentHtml + this.buildMetadataHtml(signatureData, profileHtml, certChainHtml);
        }

        const metadataHtml = this.buildMetadataHtml(signatureData, profileHtml, certChainHtml);

        return (
            contentHtml.slice(0, insertionPoint) +
            metadataHtml +
            contentHtml.slice(insertionPoint)
        );
    }

    /**
     * Build the metadata HTML string.
     */
    private buildMetadataHtml(
        signatureData?: string,
        profileHtml?: string,
        certChainHtml?: string
    ): string {
        let metadataHtml = '';

        if (signatureData) {
            const escaped = this.escapeHtml(signatureData);
            metadataHtml += `<meta itemprop="signatureData" content="${escaped}">`;
        }

        if (profileHtml) {
            metadataHtml += `<div itemprop="signerProfile">${profileHtml}</div>`;
        }

        if (certChainHtml) {
            metadataHtml += `<div itemprop="certificateChain">${certChainHtml}</div>`;
        }

        return metadataHtml;
    }

    /**
     * Escape HTML entities in a string for safe embedding in HTML attributes.
     */
    private escapeHtml(str: string): string {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
