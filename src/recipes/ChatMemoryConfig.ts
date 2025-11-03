/**
 * ChatMemoryConfig Recipe for ONE.core
 * Stores configuration for chat memory extraction per topic
 */

export const ChatMemoryConfigRecipe = {
    $type$: 'Recipe' as const,
    name: 'ChatMemoryConfig',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^ChatMemoryConfig$/ }
        },
        {
            itemprop: 'topicId',
            itemtype: { type: 'string' },
            isId: true  // Makes this a versioned object with topicId as the ID
        },
        {
            itemprop: 'enabled',
            itemtype: { type: 'boolean' }
        },
        {
            itemprop: 'autoExtract',
            itemtype: { type: 'boolean' }
        },
        {
            itemprop: 'updateInterval',
            itemtype: { type: 'number' },
            optional: true  // Legacy field, keeping for backward compat
        },
        {
            itemprop: 'minConfidence',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'keywords',
            itemtype: {
                type: 'array',
                item: { type: 'string' }
            },
            optional: true
        }
    ]
};
