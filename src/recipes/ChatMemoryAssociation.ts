/**
 * ChatMemoryAssociation Recipe for ONE.core
 * Links chat topics with memory subjects
 */

export const ChatMemoryAssociationRecipe = {
    $type$: 'Recipe' as const,
    name: 'ChatMemoryAssociation',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^ChatMemoryAssociation$/ }
        },
        {
            itemprop: 'id',
            itemtype: { type: 'string' },
            isId: true  // Unique ID for this association
        },
        {
            itemprop: 'topicId',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'subjectIdHash',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'keywords',
            itemtype: {
                type: 'array',
                item: { type: 'string' }
            }
        },
        {
            itemprop: 'confidence',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'created',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'lastUpdated',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'messageCount',
            itemtype: { type: 'number' }
        }
    ]
};
