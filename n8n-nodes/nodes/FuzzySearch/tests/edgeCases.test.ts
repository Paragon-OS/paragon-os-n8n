import { describe, it, expect, beforeEach } from 'vitest';
import { FuzzySearch } from '../FuzzySearch.node';
import type { INodeExecutionData } from 'n8n-workflow';
import {
	createMockExecuteFunctions,
	buildSearchAcrossItemsParams,
	buildSearchInArrayParams,
	TestDataFactory,
} from '../FuzzySearch.test.helpers';

describe('FuzzySearch - Edge Cases', () => {
	let fuzzySearchNode: FuzzySearch;

	beforeEach(() => {
		fuzzySearchNode = new FuzzySearch();
	});

	it('should handle empty input', async () => {
		const inputData: INodeExecutionData[] = [];
		const parameters = buildSearchAcrossItemsParams({
			query: 'test',
			matchQuality: 70,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(0);
	});

	it('should handle empty query', async () => {
		const inputData: INodeExecutionData[] = [{ json: { name: 'Test' } }];
		const parameters = buildSearchAcrossItemsParams({
			query: '',
			matchQuality: 70,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
	});

	it('should handle empty array', async () => {
		const inputData = TestDataFactory.withArrayField('items', []);
		const parameters = buildSearchInArrayParams('items', {
			query: 'test',
			matchQuality: 70,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
		expect(result[0][0].json.items).toHaveLength(0);
	});

	it('should handle null values in search keys', async () => {
		const inputData: INodeExecutionData[] = [
			{ json: { name: 'Test', description: null } },
			{ json: { name: 'Another', description: 'Valid' } },
		];

		const parameters = buildSearchAcrossItemsParams({
			query: 'Valid',
			searchKeys: 'description',
			matchQuality: 70,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(1);
		expect(result[0][0].json.name).toBe('Another');
	});


	it('should handle numeric values in objects', async () => {
		const inputData: INodeExecutionData[] = [
			{ json: { id: 12345, name: 'Product' } },
			{ json: { id: 67890, name: 'Service' } },
		];

		const parameters = buildSearchAcrossItemsParams({
			query: '12345',
			searchKeys: 'id',
			matchQuality: 70,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(1);
		expect(result[0][0].json.id).toBe(12345);
	});

	it('should throw error for invalid search mode', async () => {
		const inputData: INodeExecutionData[] = [{ json: { name: 'Test' } }];
		const parameters = {
			searchMode: 'invalidMode',
			query: 'test',
			searchKeys: '',
			matchQuality: 70,
			limit: 50,
			keepOnlySet: false,
		};

		const mockContext = createMockExecuteFunctions(inputData, parameters);

		await expect(fuzzySearchNode.execute.call(mockContext)).rejects.toThrow();
	});
});

