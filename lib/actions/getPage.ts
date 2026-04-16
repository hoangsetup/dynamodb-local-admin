import { type ScanParams } from '../util';
import type { DynamoApiController } from '../dynamoDbApi';
import type { Key } from '../types';
import type { ScanCommandInput, QueryCommandInput } from '@aws-sdk/lib-dynamodb';

export async function getPage<T extends Record<string, any>>(
    ddbApi: DynamoApiController,
    TableName: string,
    scanParams: ScanParams,
    pageSize: number,
    operationType: 'query' | 'scan',
): Promise<{
    pageItems: T[];
    nextKey: Key | null;
    Count: number;
    ScannedCount: number;
    ConsumedCapacity: number;
}> {
    const pageItems: T[] = [];
    let totalScannedCount = 0;
    let totalConsumedCapacity = 0;
    let lastEvaluatedKey: Key | undefined = scanParams.ExclusiveStartKey;

    do {
        const params: ScanCommandInput | QueryCommandInput = {
            ...scanParams,
            TableName,
            Limit: pageSize - pageItems.length,
            ExclusiveStartKey: lastEvaluatedKey,
            ReturnConsumedCapacity: 'TOTAL',
        };

        const data = await ddbApi[operationType](params);

        if (data.Items) {
            pageItems.push(...(data.Items as T[]));
        }

        totalScannedCount += data.ScannedCount || 0;
        totalConsumedCapacity += data.ConsumedCapacity?.CapacityUnits || 0;
        lastEvaluatedKey = data.LastEvaluatedKey;
    } while (pageItems.length < pageSize && lastEvaluatedKey);

    return {
        pageItems,
        nextKey: lastEvaluatedKey ?? null,
        Count: pageItems.length,
        ScannedCount: totalScannedCount,
        ConsumedCapacity: totalConsumedCapacity,
    };
}
