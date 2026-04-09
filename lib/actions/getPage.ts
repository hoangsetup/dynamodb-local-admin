import type { KeySchemaElement } from '@aws-sdk/client-dynamodb';
import { extractKey, type ScanParams } from '../util';
import type { DynamoApiController } from '../dynamoDbApi';
import type { Key } from '../types';
import type { ScanCommandInput, QueryCommandInput } from '@aws-sdk/lib-dynamodb';

export async function getPage(
    ddbApi: DynamoApiController,
    keySchema: KeySchemaElement[],
    TableName: string,
    scanParams: ScanParams,
    pageSize: number,
    operationType: 'query' | 'scan',
): Promise<{
    pageItems: Record<string, any>[];
    nextKey: any;
    Count: number;
    ScannedCount: number;
    ConsumedCapacity?: number;
}> {
    const pageItems: Record<string, any>[] = [];
    let totalScannedCount = 0;
    let totalConsumedCapacity = 0;

    const params: ScanCommandInput | QueryCommandInput = {
        TableName,
        ...scanParams,
        Limit: 10,
        ReturnConsumedCapacity: 'TOTAL',
    };

    const getNextBite = async(nextKey: Key | undefined = undefined): Promise<void> => {
        if (nextKey) {
            params.ExclusiveStartKey = nextKey;
        }

        const data = await ddbApi[operationType](params);

        if (data.Items && data.Items.length > 0) {
            for (let i = 0; i < data.Items.length && pageItems.length < pageSize + 1; i++) {
                pageItems.push(data.Items[i]);
            }
        }

        totalScannedCount += data.ScannedCount || 0;
        totalConsumedCapacity += data.ConsumedCapacity?.CapacityUnits || 0;

        const lastStartKey = data.LastEvaluatedKey;

        // If there is more items to query (!lastStartKey) then don't stop until
        // we are over pageSize count. Stopping at exactly pageSize count would
        // not extract key of last item later and make pagination not work.
        if (pageItems.length <= pageSize && lastStartKey) {
            await getNextBite(lastStartKey);
        }
    };

    await getNextBite();

    let nextKey = null;
    let items = pageItems;

    if (items.length > pageSize) {
        items = items.slice(0, pageSize);
        nextKey = extractKey(items[pageSize - 1], keySchema);
    }

    return {
        pageItems: items,
        nextKey,
        Count: items.length,
        ScannedCount: totalScannedCount,
        ConsumedCapacity: totalConsumedCapacity,
    };
}

