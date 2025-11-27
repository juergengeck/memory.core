/**
 * ONE.core Recipe for Memory objects
 *
 * Memory is a constructed document synthesizing information from subjects.
 * Identity is determined by title + author combination.
 */
export const MemoryRecipe = {
    $type$: 'Recipe',
    name: 'Memory',
    rule: [
        {
            itemprop: 'title',
            itemtype: { type: 'string' },
            isId: true
        },
        {
            itemprop: 'author',
            itemtype: { type: 'string' },
            isId: true
        },
        {
            itemprop: 'facts',
            itemtype: {
                type: 'array',
                item: {
                    type: 'object',
                    rules: [
                        {
                            itemprop: 'statement',
                            itemtype: { type: 'string' }
                        },
                        {
                            itemprop: 'confidence',
                            itemtype: { type: 'number' }
                        },
                        {
                            itemprop: 'sourceRef',
                            itemtype: { type: 'string' },
                            optional: true
                        }
                    ]
                }
            }
        },
        {
            itemprop: 'entities',
            itemtype: {
                type: 'array',
                item: {
                    type: 'object',
                    rules: [
                        {
                            itemprop: 'name',
                            itemtype: { type: 'string' }
                        },
                        {
                            itemprop: 'type',
                            itemtype: { type: 'string' }
                        },
                        {
                            itemprop: 'description',
                            itemtype: { type: 'string' },
                            optional: true
                        }
                    ]
                }
            }
        },
        {
            itemprop: 'relationships',
            itemtype: {
                type: 'array',
                item: {
                    type: 'object',
                    rules: [
                        {
                            itemprop: 'fromEntity',
                            itemtype: { type: 'string' }
                        },
                        {
                            itemprop: 'toEntity',
                            itemtype: { type: 'string' }
                        },
                        {
                            itemprop: 'relationType',
                            itemtype: { type: 'string' }
                        }
                    ]
                }
            }
        },
        {
            itemprop: 'prose',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'sourceSubjects',
            itemtype: {
                type: 'array',
                item: { type: 'string' }
            }
        }
    ]
};
