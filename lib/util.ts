import type { AttributeDefinition, KeySchemaElement, TableDescription } from '@aws-sdk/client-dynamodb';
import type { QueryCommandInput, ScanCommandInput } from '@aws-sdk/lib-dynamodb';
import type { DynamoApiController } from './dynamoDbApi';
import type { ItemList, Key } from './types';

export class DynamoDBAdminError extends Error {
    public status: number;

    constructor(message: string, status: number = 500) {
        super(message);
        this.status = status;
    }
}

export type ScanParams = Omit<ScanCommandInput & QueryCommandInput, 'TableName' | 'Limit'>;

export function extractKey(item: Record<string, any>, keySchema: KeySchemaElement[]): Record<string, any> {
    return keySchema.reduce((prev, current) => {
        return {
            ...prev,
            ...current.AttributeName ? { [current.AttributeName]: item[current.AttributeName] } : {},
        };
    }, {});
}

export function parseKey(keys: string, tableDescription: TableDescription): Record<string, string | number> {
    const splitKeys = keys.split(',');

    return tableDescription.KeySchema!.reduce((prev, current, index) => {
        return {
            ...prev,
            ...current.AttributeName ? { [current.AttributeName]: typecastKey(current.AttributeName, splitKeys[index], tableDescription) } : {},
        };
    }, {});
}

export function extractKeysForItems(Items: Record<string, any>[]): string[] {
    const keys = new Set<string>();
    for (const item of Items) {
        for (const key of Object.keys(item)) {
            if (!keys.has(key)) {
                keys.add(key);
            }
        }
    }
    return Array.from<string>(keys);
}

/**
 * Invokes a database scan
 *
 * @param ddbApi The AWS DynamoDB client
 * @param tableName The table name
 * @param scanParams Extra params for the query
 * @param limit The of items to request per chunked query. NOT a limit
 *                       of items that should be returned.
 * @param startKey The key to start query from
 * @param progress Function to execute on each new items returned from query. Returns true to stop the query.
 * @param readOperation The read operation
 */
export async function doSearch(
    ddbApi: DynamoApiController,
    tableName: string,
    scanParams: ScanParams,
    limit?: number,
    progress?: (items: ItemList | undefined, lastStartKey: Key | undefined) => boolean,
    readOperation: 'query' | 'scan' = 'scan',
): Promise<ItemList> {
    const params: ScanCommandInput | QueryCommandInput = {
        TableName: tableName,
        ...scanParams ? scanParams : {},
        ...limit !== undefined ? { Limit: limit } : {},
    };

    let items: ItemList = [];

    const getNextBite = async(params: ScanCommandInput | QueryCommandInput, nextKey: Key | undefined = undefined): Promise<ItemList> => {
        if (nextKey) {
            params.ExclusiveStartKey = nextKey;
        }

        const data = await ddbApi[readOperation](params);
        if (data.Items && data.Items.length > 0) {
            items = items.concat(data.Items);
        }

        let lastStartKey = undefined;
        if (data) {
            lastStartKey = data.LastEvaluatedKey;
        }

        if (progress) {
            const stop = progress(data.Items, lastStartKey);

            if (stop) {
                return items;
            }
        }

        if (!lastStartKey) {
            return items;
        }

        return await getNextBite(params, lastStartKey);
    };

    return await getNextBite(params);
}

function typecastKey(keyName: string, keyValue: string, table: TableDescription): string | number {
    const definition = table.AttributeDefinitions!.find(attribute => attribute.AttributeName === keyName);
    if (definition) {
        switch (definition.AttributeType) {
            case 'N':
                return Number(keyValue);
            case 'S':
                return String(keyValue);
        }
    }
    return keyValue;
}

export function isAttributeNotAlreadyCreated(attributeDefinitions: AttributeDefinition[], attributeName: string): boolean {
    return !attributeDefinitions.find(attributeDefinition => attributeDefinition.AttributeName === attributeName);
}

export function buildScanParams({
    filters,
    ExclusiveStartKey,
    queryableSelection,
    indexBeingUsed,
}: {
    filters: Record<string, {
        operator: string;
        type?: 'N' | 'S';
        value: string | number;
    }>;
    ExclusiveStartKey: Record<string, unknown>;
    queryableSelection: string;
    indexBeingUsed: { KeySchema?: { AttributeName?: string; KeyType?: string }[] } | null;
}): ScanParams {
    const ExpressionAttributeNames: NonNullable<ScanCommandInput['ExpressionAttributeNames']> = {};
    const ExpressionAttributeValues: NonNullable<ScanCommandInput['ExpressionAttributeValues']> = {};
    const FilterExpressions: string[] = [];
    const KeyConditionExpressions: string[] = [];

    Object.entries(filters).forEach(([key, { operator, type, value}], i) => {
        const namePlaceholder = `#key${i}`;
        const valuePlaceholder = `:key${i}`;
        const isExistsOperator = ['attribute_exists', 'attribute_not_exists'].includes(operator);

        ExpressionAttributeNames[namePlaceholder] = key;

        if (isExistsOperator) {
            FilterExpressions.push(`${operator}(${namePlaceholder})`);
        } else {
            ExpressionAttributeValues[valuePlaceholder] = type === 'N' ? Number(value) : value;

            const isKey = indexBeingUsed?.KeySchema?.some(k => k.AttributeName === key);
            const targetExpressions = isKey ? KeyConditionExpressions : FilterExpressions;
            const expressionMap: Record<string, string> = {
                'begins_with': `${operator}(${namePlaceholder}, ${valuePlaceholder})`,
                'contains': `${operator}(${namePlaceholder}, ${valuePlaceholder})`,
                'not contains': `NOT contains(${namePlaceholder}, ${valuePlaceholder})`,
            };
            targetExpressions.push(expressionMap[operator] ?? `${namePlaceholder} ${operator} ${valuePlaceholder}`);
        }
    });

    return {
        FilterExpression: FilterExpressions.length ? FilterExpressions.join(' AND ') : undefined,
        ExclusiveStartKey: Object.keys(ExclusiveStartKey).length ? ExclusiveStartKey : undefined,
        ExpressionAttributeNames: Object.keys(ExpressionAttributeNames).length ? ExpressionAttributeNames : undefined,
        ExpressionAttributeValues: Object.keys(ExpressionAttributeValues).length ? ExpressionAttributeValues : undefined,
        KeyConditionExpression: KeyConditionExpressions.length ? KeyConditionExpressions.join(' AND ') : undefined,
        IndexName: queryableSelection !== 'table' ? queryableSelection : undefined,
    };
}
