import { describe, it, expect, beforeEach } from 'vitest';
import { FuzzySearch } from '../FuzzySearch.node';
import type { INodeExecutionData } from 'n8n-workflow';
import {
	createMockExecuteFunctions,
	buildSearchAcrossItemsParams,
	buildSearchInArrayParams,
	TestDataFactory,
} from '../FuzzySearch.test.helpers';

describe('FuzzySearch - Include Match Score Feature', () => {
	let fuzzySearchNode: FuzzySearch;

	beforeEach(() => {
		fuzzySearchNode = new FuzzySearch();
	});

	describe('Search Across Items Mode', () => {
		it('should include match score when includeScore is true', async () => {
			const inputData: INodeExecutionData[] = [
				{ json: { name: 'John Doe', email: 'john@example.com' } },
				{ json: { name: 'Jane Smith', email: 'jane@example.com' } },
				{ json: { name: 'Jon Snow', email: 'jon@example.com' } },
			];

			const parameters = buildSearchAcrossItemsParams({
				query: 'John',
				searchKeys: 'name',
				matchQuality: 30,
				includeScore: true,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0].length).toBeGreaterThan(0);

			for (const item of result[0]) {
				expect(item.json).toHaveProperty('_fuzzyScore');
				expect(typeof item.json._fuzzyScore).toBe('number');
				expect(item.json._fuzzyScore).toBeGreaterThanOrEqual(-1000);
				expect(item.json._fuzzyScore).toBeLessThanOrEqual(1000);
			}
		});

		it('should have better scores for better matches', async () => {
			const inputData: INodeExecutionData[] = [
				{ json: { name: 'John' } },
				{ json: { name: 'Jonathan' } },
				{ json: { name: 'Johnny' } },
			];

			const parameters = buildSearchAcrossItemsParams({
				query: 'John',
				searchKeys: 'name',
				matchQuality: 0,
				includeScore: true,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0].length).toBeGreaterThanOrEqual(2);

			const firstScore = result[0][0].json._fuzzyScore as number;
			const secondScore = result[0][1].json._fuzzyScore as number;

			expect(firstScore).toBeGreaterThanOrEqual(secondScore);
		});
	});

	describe('Search in Array Field Mode', () => {
		it('should include match score in array elements when includeScore is true', async () => {
			const inputData = TestDataFactory.withArrayField('products', [
				{ name: 'Apple iPhone', price: 999 },
				{ name: 'Samsung Galaxy', price: 899 },
				{ name: 'Google Pixel', price: 799 },
			]);

			const parameters = buildSearchInArrayParams('products', {
				query: 'Apple',
				searchKeys: 'name',
				matchQuality: 30,
				includeScore: true,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0]).toHaveLength(1);

			const products = result[0][0].json.products as any[];
			expect(products.length).toBeGreaterThan(0);

			for (const product of products) {
				expect(product).toHaveProperty('_fuzzyScore');
				expect(typeof product._fuzzyScore).toBe('number');
			}

			expect(result[0][0].json).toHaveProperty('_fuzzyScoreInfo');
			expect(result[0][0].json._fuzzyScoreInfo).toHaveProperty('totalMatches');
			expect(result[0][0].json._fuzzyScoreInfo).toHaveProperty('topScore');
		});

		it('should handle string array elements without adding score', async () => {
			const inputData = TestDataFactory.withArrayField('tags', [
				'apple',
				'banana',
				'orange',
				'grape',
			]);

			const parameters = buildSearchInArrayParams('tags', {
				query: 'apple',
				matchQuality: 30,
				includeScore: true,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0]).toHaveLength(1);

			const tags = result[0][0].json.tags as string[];
			expect(tags.length).toBeGreaterThan(0);

			for (const tag of tags) {
				expect(typeof tag).toBe('string');
			}

			expect(result[0][0].json).toHaveProperty('_fuzzyScoreInfo');
		});
	});

	describe('Progressive Threshold Lowering', () => {
		it('should return at least one result by lowering threshold when no strict matches found', async () => {
			const inputData: INodeExecutionData[] = [
				{ json: { name: 'Application Manager' } },
				{ json: { name: 'Applied Sciences' } },
				{ json: { name: 'Applicator Tool' } },
			];

			const parameters = buildSearchAcrossItemsParams({
				query: 'apple',
				searchKeys: 'name',
				matchQuality: 95,
				includeScore: true,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0].length).toBeGreaterThanOrEqual(1);
			expect(result[0][0].json).toHaveProperty('_fuzzyScore');
			expect(result[0][0].json).toHaveProperty('_isAboveThreshold');
			expect(result[0][0].json._isAboveThreshold).toBe(false);
		});

		it('should return topScore in array search even with poor matches', async () => {
			const inputData = TestDataFactory.withArrayField('products', [
				{ name: 'Samsung Galaxy', price: 100 },
				{ name: 'Sony Xperia', price: 200 },
				{ name: 'Huawei Mate', price: 300 },
			]);

			const parameters = buildSearchInArrayParams('products', {
				query: 'sam',
				searchKeys: 'name',
				matchQuality: 95,
				includeScore: true,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0]).toHaveLength(1);

			const scoreInfo = result[0][0].json._fuzzyScoreInfo as any;
			expect(scoreInfo).toBeDefined();
			expect(scoreInfo.totalMatches).toBeGreaterThanOrEqual(1);
			expect(scoreInfo.topScore).not.toBeNull();
			expect(typeof scoreInfo.topScore).toBe('number');
			expect(scoreInfo).toHaveProperty('isAboveThreshold');
			expect(typeof scoreInfo.isAboveThreshold).toBe('boolean');
		});

		it('should mark results as above threshold when they meet the criteria', async () => {
			const inputData: INodeExecutionData[] = [
				{ json: { name: 'Apple' } },
				{ json: { name: 'Application' } },
				{ json: { name: 'Banana' } },
			];

			const parameters = buildSearchAcrossItemsParams({
				query: 'Apple',
				searchKeys: 'name',
				matchQuality: 70,
				includeScore: true,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0].length).toBeGreaterThanOrEqual(1);

			expect(result[0][0].json).toHaveProperty('_isAboveThreshold');
			expect(result[0][0].json._isAboveThreshold).toBe(true);
		});

	});
});

