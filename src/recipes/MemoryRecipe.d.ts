/**
 * ONE.core Recipe for Memory objects
 *
 * Memory is a constructed document synthesizing information from subjects.
 * Identity is determined by title + author combination.
 */
export declare const MemoryRecipe: {
    $type$: string;
    name: string;
    rule: ({
        itemprop: string;
        itemtype: {
            type: string;
            item?: undefined;
        };
        isId: boolean;
    } | {
        itemprop: string;
        itemtype: {
            type: string;
            item: {
                type: string;
                rules: ({
                    itemprop: string;
                    itemtype: {
                        type: string;
                    };
                    optional?: undefined;
                } | {
                    itemprop: string;
                    itemtype: {
                        type: string;
                    };
                    optional: boolean;
                })[];
            };
        };
        isId?: undefined;
    } | {
        itemprop: string;
        itemtype: {
            type: string;
            item?: undefined;
        };
        isId?: undefined;
    } | {
        itemprop: string;
        itemtype: {
            type: string;
            item: {
                type: string;
                rules?: undefined;
            };
        };
        isId?: undefined;
    })[];
};
