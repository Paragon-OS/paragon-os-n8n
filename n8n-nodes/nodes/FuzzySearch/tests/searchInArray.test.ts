import { describe, it, expect, beforeEach } from 'vitest';
import { FuzzySearch } from '../FuzzySearch.node';
import type { INodeExecutionData } from 'n8n-workflow';
import {
	createMockExecuteFunctions,
	buildSearchInArrayParams,
	TestDataFactory,
} from '../FuzzySearch.test.helpers';

describe('FuzzySearch - Search In Array Mode', () => {
	let fuzzySearchNode: FuzzySearch;

	beforeEach(() => {
		fuzzySearchNode = new FuzzySearch();
	});

	describe('Basic Array Search', () => {
		it('should search within an array field', async () => {
			const inputData = TestDataFactory.withArrayField('items', [
				{ name: 'Apple', price: 1.5 },
				{ name: 'Banana', price: 0.5 },
				{ name: 'Cherry', price: 2.0 },
			]);

			const parameters = buildSearchInArrayParams('items', {
				query: 'Apple',
				matchQuality: 70,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0]).toHaveLength(1);
			const items = result[0][0].json.items as any[];
			expect(items).toHaveLength(1);
			expect(items[0].name).toBe('Apple');
		});

		it('should search array with specific keys', async () => {
			const inputData = TestDataFactory.withArrayField('products', [
				{ name: 'Laptop', category: 'Electronics', price: 999 },
				{ name: 'Mouse', category: 'Electronics', price: 25 },
				{ name: 'Desk', category: 'Furniture', price: 299 },
			]);

			const parameters = buildSearchInArrayParams('products', {
				query: 'Electronics',
				searchKeys: 'category',
				matchQuality: 50,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0][0].json.products).toHaveLength(2); // Laptop and Mouse
		});

		it('should handle nested array fields with dot notation', async () => {
			const inputData: INodeExecutionData[] = [
				{
					json: {
						data: {
							users: [
								{ name: 'Alice', role: 'Admin' },
								{ name: 'Bob', role: 'User' },
								{ name: 'Charlie', role: 'Admin' },
							],
						},
					},
				},
			];

			const parameters = buildSearchInArrayParams('data.users', {
				query: 'Admin',
				searchKeys: 'role',
				matchQuality: 70,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			const data = result[0][0].json.data as any;
			expect(data.users).toHaveLength(2); // Alice and Charlie
		});

		it('should handle array of strings', async () => {
			const inputData = TestDataFactory.withArrayField('tags', [
				'javascript',
				'typescript',
				'python',
				'java',
				'rust',
			]);

			const parameters = buildSearchInArrayParams('tags', {
				query: 'script',
				matchQuality: 50,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			const tags = result[0][0].json.tags as string[];
			expect(tags.length).toBeGreaterThanOrEqual(1);
			expect(tags).toContain('javascript');
			expect(tags).toContain('typescript');
		});
	});

	describe('Error Handling', () => {
		it('should throw error if array field does not exist', async () => {
			const inputData: INodeExecutionData[] = [
				{
					json: {
						notAnArray: 'some value',
					},
				},
			];

			const parameters = buildSearchInArrayParams('missingField', {
				query: 'test',
				matchQuality: 70,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);

			await expect(fuzzySearchNode.execute.call(mockContext)).rejects.toThrow(
				'is not an array or does not exist',
			);
		});

		it('should throw error if field is not an array', async () => {
			const inputData: INodeExecutionData[] = [
				{
					json: {
						notAnArray: 'string value',
					},
				},
			];

			const parameters = buildSearchInArrayParams('notAnArray', {
				query: 'test',
				matchQuality: 70,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);

			await expect(fuzzySearchNode.execute.call(mockContext)).rejects.toThrow(
				'is not an array or does not exist',
			);
		});
	});

	describe('Limit and Threshold', () => {
		it('should respect limit in array search', async () => {
			const inputData = TestDataFactory.withArrayField(
				'items',
				TestDataFactory.testItems(5).map((item) => item.json),
			);

			const parameters = buildSearchInArrayParams('items', {
				query: 'Test',
				matchQuality: 70,
				limit: 2,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			const items = result[0][0].json.items as any[];
			expect(items.length).toBeLessThanOrEqual(2);
		});

		it('should respect threshold in array search - strict threshold filters results', async () => {
			const inputData = TestDataFactory.withArrayField('products', [
				{ name: 'Apple iPhone 15' },
				{ name: 'Apple MacBook' },
				{ name: 'Samsung Galaxy' },
				{ name: 'Pineapple' },
				{ name: 'Application' },
			]);

			const parameters = buildSearchInArrayParams('products', {
				query: 'Apple',
				searchKeys: 'name',
				matchQuality: 80,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			const products = result[0][0].json.products as any[];

			expect(products.length).toBeGreaterThan(0);
			expect(products.length).toBeLessThan(5);
			expect(products[0].name).toContain('Apple');
		});

	});

	describe('KeepOnlySet Parameter', () => {
		it('should preserve other fields when keepOnlySet is false', async () => {
			const inputData: INodeExecutionData[] = [
				{
					json: {
						otherField: 'should be preserved',
						items: [{ name: 'Test 1' }, { name: 'Test 2' }],
					},
				},
			];

			const parameters = buildSearchInArrayParams('items', {
				query: 'Test',
				matchQuality: 70,
				keepOnlySet: false,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0][0].json.otherField).toBe('should be preserved');
		});

		it('should only keep filtered array when keepOnlySet is true', async () => {
			const inputData: INodeExecutionData[] = [
				{
					json: {
						otherField: 'should be removed',
						items: [{ name: 'Test 1' }, { name: 'Test 2' }],
					},
				},
			];

			const parameters = buildSearchInArrayParams('items', {
				query: 'Test',
				matchQuality: 70,
				keepOnlySet: true,
			});

			const mockContext = createMockExecuteFunctions(inputData, parameters);
			const result = await fuzzySearchNode.execute.call(mockContext);

			expect(result).toHaveLength(1);
			expect(result[0][0].json.otherField).toBeUndefined();
			expect(result[0][0].json.items).toBeDefined();
		});
	});
});

