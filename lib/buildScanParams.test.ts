import { describe, it, expect } from 'vitest';
import { buildScanParams } from './util';

const noIndex = null;

const tableIndex = {
    KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
};

const gsiIndex = {
    KeySchema: [
        { AttributeName: 'gsi_pk', KeyType: 'HASH' },
        { AttributeName: 'gsi_sk', KeyType: 'RANGE' },
    ],
};

describe('buildScanParams', () => {
    describe('empty inputs', () => {
        it('returns all undefined fields when given no filters and no ExclusiveStartKey', () => {
            const result = buildScanParams({
                filters: {},
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: noIndex,
            });

            expect(result).toEqual({
                FilterExpression: undefined,
                ExclusiveStartKey: undefined,
                ExpressionAttributeNames: undefined,
                ExpressionAttributeValues: undefined,
                KeyConditionExpression: undefined,
                IndexName: undefined,
            });
        });
    });

    describe('ExclusiveStartKey', () => {
        it('includes ExclusiveStartKey when it has keys', () => {
            const startKey = { pk: 'abc', sk: '123' };
            const result = buildScanParams({
                filters: {},
                ExclusiveStartKey: startKey,
                queryableSelection: 'table',
                indexBeingUsed: noIndex,
            });

            expect(result.ExclusiveStartKey).toEqual(startKey);
        });

        it('omits ExclusiveStartKey when empty object', () => {
            const result = buildScanParams({
                filters: {},
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: noIndex,
            });

            expect(result.ExclusiveStartKey).toBeUndefined();
        });
    });

    describe('IndexName', () => {
        it('sets IndexName when queryableSelection is not "table"', () => {
            const result = buildScanParams({
                filters: {},
                ExclusiveStartKey: {},
                queryableSelection: 'my-gsi-index',
                indexBeingUsed: noIndex,
            });

            expect(result.IndexName).toBe('my-gsi-index');
        });

        it('omits IndexName when queryableSelection is "table"', () => {
            const result = buildScanParams({
                filters: {},
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: noIndex,
            });

            expect(result.IndexName).toBeUndefined();
        });
    });

    describe('attribute_exists / attribute_not_exists operators', () => {
        it('builds attribute_exists FilterExpression without a value', () => {
            const result = buildScanParams({
                filters: { status: { operator: 'attribute_exists', value: '' } },
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: noIndex,
            });

            expect(result.FilterExpression).toBe('attribute_exists(#key0)');
            expect(result.ExpressionAttributeNames).toEqual({ '#key0': 'status' });
            expect(result.ExpressionAttributeValues).toBeUndefined();
        });

        it('builds attribute_not_exists FilterExpression without a value', () => {
            const result = buildScanParams({
                filters: { deletedAt: { operator: 'attribute_not_exists', value: '' } },
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: noIndex,
            });

            expect(result.FilterExpression).toBe('attribute_not_exists(#key0)');
        });
    });

    describe('standard comparison operators (scan — no index)', () => {
        it.each([
            ['=',  '#key0 = :key0' ],
            ['<>', '#key0 <> :key0'],
            ['<',  '#key0 < :key0' ],
            ['<=', '#key0 <= :key0'],
            ['>',  '#key0 > :key0' ],
            ['>=', '#key0 >= :key0'],
        ])('builds FilterExpression for operator "%s"', (operator, expected) => {
            const result = buildScanParams({
                filters: { name: { operator, value: 'Alice' } },
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: noIndex,
            });

            expect(result.FilterExpression).toBe(expected);
            expect(result.ExpressionAttributeNames).toEqual({ '#key0': 'name' });
            expect(result.ExpressionAttributeValues).toEqual({ ':key0': 'Alice' });
            expect(result.KeyConditionExpression).toBeUndefined();
        });

        it('builds contains() FilterExpression', () => {
            const result = buildScanParams({
                filters: { bio: { operator: 'contains', value: 'engineer' } },
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: noIndex,
            });

            expect(result.FilterExpression).toBe('contains(#key0, :key0)');
        });

        it('builds not contains() FilterExpression', () => {
            const result = buildScanParams({
                filters: { bio: { operator: 'not contains', value: 'manager' } },
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: noIndex,
            });

            expect(result.FilterExpression).toBe('NOT contains(#key0, :key0)');
        });

        it('builds begins_with() FilterExpression for non-key attributes', () => {
            const result = buildScanParams({
                filters: { email: { operator: 'begins_with', value: 'admin' } },
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: noIndex,
            });

            expect(result.FilterExpression).toBe('begins_with(#key0, :key0)');
            expect(result.KeyConditionExpression).toBeUndefined();
        });
    });

    describe('numeric type coercion', () => {
        it('coerces value to Number when type is "N"', () => {
            const result = buildScanParams({
                filters: { age: { operator: '=', type: 'N', value: '42' } },
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: noIndex,
            });

            expect(result.ExpressionAttributeValues).toEqual({ ':key0': 42 });
        });

        it('does not mutate the original filters object', () => {
            const filters = { age: { operator: '=', type: 'N' as const, value: '42' as string | number } };
            buildScanParams({
                filters,
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: noIndex,
            });

            expect(filters.age.value).toBe('42'); // original unchanged
        });
    });

    describe('query mode — HASH key', () => {
        it('puts HASH key filter into KeyConditionExpression', () => {
            const result = buildScanParams({
                filters: { pk: { operator: '=', value: 'user#1' } },
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: tableIndex,
            });

            expect(result.KeyConditionExpression).toBe('#key0 = :key0');
            expect(result.FilterExpression).toBeUndefined();
        });
    });

    describe('query mode — RANGE key', () => {
        it('puts RANGE key equality filter into KeyConditionExpression', () => {
            const result = buildScanParams({
                filters: { sk: { operator: '=', value: 'order#99' } },
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: tableIndex,
            });

            expect(result.KeyConditionExpression).toBe('#key0 = :key0');
            expect(result.FilterExpression).toBeUndefined();
        });

        it('uses begins_with() syntax for RANGE key with begins_with operator', () => {
            const result = buildScanParams({
                filters: { sk: { operator: 'begins_with', value: 'order#' } },
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: tableIndex,
            });

            expect(result.KeyConditionExpression).toBe('begins_with(#key0, :key0)');
            expect(result.FilterExpression).toBeUndefined();
        });

        // it('does NOT use begins_with() syntax for HASH key even if operator is begins_with', () => {
        //     const result = buildScanParams({
        //         filters: { pk: { operator: 'begins_with', value: 'user#' } },
        //         ExclusiveStartKey: {},
        //         queryableSelection: 'table',
        //         indexBeingUsed: tableIndex,
        //     });
        //
        //     // HASH key with begins_with falls through to standard KeyConditionExpression form
        //     expect(result.KeyConditionExpression).toBe('#key0 begins_with :key0');
        // });
    });

    describe('query mode — GSI keys', () => {
        it('routes GSI HASH key to KeyConditionExpression', () => {
            const result = buildScanParams({
                filters: { gsi_pk: { operator: '=', value: 'tenant#abc' } },
                ExclusiveStartKey: {},
                queryableSelection: 'my-gsi',
                indexBeingUsed: gsiIndex,
            });

            expect(result.KeyConditionExpression).toBe('#key0 = :key0');
            expect(result.FilterExpression).toBeUndefined();
        });

        it('routes GSI RANGE key with begins_with to KeyConditionExpression', () => {
            const result = buildScanParams({
                filters: { gsi_sk: { operator: 'begins_with', value: '2024-' } },
                ExclusiveStartKey: {},
                queryableSelection: 'my-gsi',
                indexBeingUsed: gsiIndex,
            });

            expect(result.KeyConditionExpression).toBe('begins_with(#key0, :key0)');
        });
    });

    describe('multiple filters', () => {
        it('ANDs multiple FilterExpressions together', () => {
            const result = buildScanParams({
                filters: {
                    status: { operator: '=', value: 'active' },
                    role: { operator: '=', value: 'admin' },
                },
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: noIndex,
            });

            expect(result.FilterExpression).toBe('#key0 = :key0 AND #key1 = :key1');
            expect(result.ExpressionAttributeNames).toEqual({ '#key0': 'status', '#key1': 'role' });
            expect(result.ExpressionAttributeValues).toEqual({ ':key0': 'active', ':key1': 'admin' });
        });

        it('ANDs multiple KeyConditionExpressions together', () => {
            const result = buildScanParams({
                filters: {
                    pk: { operator: '=', value: 'user#1' },
                    sk: { operator: 'begins_with', value: 'order#' },
                },
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: tableIndex,
            });

            expect(result.KeyConditionExpression).toBe('#key0 = :key0 AND begins_with(#key1, :key1)');
            expect(result.FilterExpression).toBeUndefined();
        });

        it('mixes KeyConditionExpression and FilterExpression correctly', () => {
            const result = buildScanParams({
                filters: {
                    pk: { operator: '=', value: 'user#1' },
                    status: { operator: '=', value: 'active' },
                },
                ExclusiveStartKey: {},
                queryableSelection: 'table',
                indexBeingUsed: tableIndex,
            });

            expect(result.KeyConditionExpression).toBe('#key0 = :key0');
            expect(result.FilterExpression).toBe('#key1 = :key1');
            expect(result.ExpressionAttributeNames).toEqual({ '#key0': 'pk', '#key1': 'status' });
            expect(result.ExpressionAttributeValues).toEqual({ ':key0': 'user#1', ':key1': 'active' });
        });
    });
});
