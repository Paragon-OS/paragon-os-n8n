import { describe, it, expect, beforeEach } from 'vitest';
import { FuzzySearch } from '../FuzzySearch.node';
import type { INodeExecutionData } from 'n8n-workflow';
import {
	createMockExecuteFunctions,
	buildSearchAcrossItemsParams,
	TestDataFactory,
} from '../FuzzySearch.test.helpers';

describe('FuzzySearch - Search Across Items Mode', () => {
	let fuzzySearchNode: FuzzySearch;

	beforeEach(() => {
		fuzzySearchNode = new FuzzySearch();
	});

	describe('Basic Search Functionality', () => {
		it('should find exact matches', async () => {
			const inputData = TestDataFactory.users();
			const parameters = buildSearchAcrossItemsParams({
				query: 'John',
				matchQuality: 30,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0]).toHaveLength(2); // John Doe and Bob Johnson
			expect(result[0][0].json.name).toContain('John');
		});

		it('should search specific keys when provided', async () => {
			const inputData = TestDataFactory.products();
			const parameters = buildSearchAcrossItemsParams({
				query: 'Fruit',
				searchKeys: 'category',
				matchQuality: 70,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0]).toHaveLength(2); // Apple and Banana
			expect(result[0][0].json.category).toBe('Fruit');
			expect(result[0][1].json.category).toBe('Fruit');
		});

		it('should search multiple keys when provided', async () => {
			const inputData: INodeExecutionData[] = [
				{ json: { name: 'John', role: 'Developer', email: 'john@dev.com' } },
				{ json: { name: 'Jane', role: 'Designer', email: 'jane@design.com' } },
				{ json: { name: 'Bob', role: 'Developer', email: 'bob@dev.com' } },
			];

			const parameters = buildSearchAcrossItemsParams({
				query: 'Developer',
				searchKeys: 'name\nrole',
				matchQuality: 70,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0]).toHaveLength(2); // John and Bob
		});

		it('should handle nested keys with dot notation', async () => {
			const inputData = TestDataFactory.nestedUsers();
			const parameters = buildSearchAcrossItemsParams({
				query: 'Alice',
				searchKeys: 'user.name',
				matchQuality: 70,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0]).toHaveLength(1);
			const user = result[0][0].json.user as any;
			expect(user.name).toBe('Alice');
		});
	});

	describe('Threshold/Match Quality', () => {
		it('should filter out poor matches with strict threshold', async () => {
			const inputData = TestDataFactory.programmingLanguages();
			const parameters = buildSearchAcrossItemsParams({
				query: 'JavaScript',
				searchKeys: 'name',
				matchQuality: 98, // Strict
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0].length).toBeGreaterThan(0);
			expect(result[0].length).toBeLessThan(4);
			expect(result[0][0].json.name).toContain('JavaScript');
		});

		it('should include more matches with lenient threshold', async () => {
			const inputData: INodeExecutionData[] = [
				{ json: { name: 'JavaScript' } },
				{ json: { name: 'JavaScripting' } },
				{ json: { name: 'Java' } },
				{ json: { name: 'Python' } },
			];

			const parameters = buildSearchAcrossItemsParams({
				query: 'JavaScript',
				searchKeys: 'name',
				matchQuality: 50, // Lenient
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0].length).toBeGreaterThanOrEqual(2);
			expect(result[0][0].json.name).toBe('JavaScript');
		});

		it('should return no results if threshold is too strict for any match', async () => {
			const inputData: INodeExecutionData[] = [
				{ json: { name: 'similar word' } },
				{ json: { name: 'close match' } },
				{ json: { name: 'kinda related' } },
			];

			const parameters = buildSearchAcrossItemsParams({
				query: 'exactmatch',
				searchKeys: 'name',
				matchQuality: 100,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0].length).toBe(0);
		});
	});

	describe('Limit and Fuzzy Matching', () => {
		it('should respect limit parameter', async () => {
			const inputData = TestDataFactory.testItems(5);
			const parameters = buildSearchAcrossItemsParams({
				query: 'Test',
				matchQuality: 70,
				limit: 2,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0].length).toBeLessThanOrEqual(2);
		});
	});

	describe('Data Preservation', () => {
		it('should respect keepOnlySet parameter', async () => {
			const inputData: INodeExecutionData[] = [
				{ json: { name: 'Test', extra: 'data', more: 'info' } },
			];

			const parameters = buildSearchAcrossItemsParams({
				query: 'Test',
				matchQuality: 50,
				keepOnlySet: true,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0]).toHaveLength(1);
			expect(result[0][0].json).toEqual({});
		});

		it('should preserve binary data', async () => {
			const inputData: INodeExecutionData[] = [
				{
					json: { name: 'Test' },
					binary: { file: { data: 'base64data', mimeType: 'text/plain' } },
				},
			];

			const parameters = buildSearchAcrossItemsParams({
				query: 'Test',
				matchQuality: 70,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0][0].binary).toBeDefined();
			expect(result[0][0].binary?.file).toBeDefined();
		});
	});
});

