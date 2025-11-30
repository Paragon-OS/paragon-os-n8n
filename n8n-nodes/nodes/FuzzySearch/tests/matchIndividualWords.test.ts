import { describe, it, expect, beforeEach } from 'vitest';
import { FuzzySearch } from '../FuzzySearch.node';
import type { INodeExecutionData } from 'n8n-workflow';
import {
	createMockExecuteFunctions,
	buildSearchAcrossItemsParams,
	buildSearchInArrayParams,
} from '../FuzzySearch.test.helpers';

describe('FuzzySearch - Match Individual Words Feature', () => {
	let fuzzySearchNode: FuzzySearch;

	beforeEach(() => {
		fuzzySearchNode = new FuzzySearch();
	});

	it('should work correctly with single word query', async () => {
		const inputData: INodeExecutionData[] = [
			{ json: { name: 'Clemens Ley' } },
			{ json: { name: 'John Smith' } },
			{ json: { name: 'Jane Ley' } },
		];

		const parameters = buildSearchAcrossItemsParams({
			query: 'ley',
			searchKeys: 'name',
			matchQuality: 70,
			includeScore: true,
			matchIndividualWords: true,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
		expect(result[0].length).toBeGreaterThanOrEqual(1);

		const names = result[0].map((item) => item.json.name);
		expect(names).toContain('Clemens Ley');
		expect(names).toContain('Jane Ley');

		for (const item of result[0]) {
			expect(item.json).toHaveProperty('_fuzzyScore');
			expect(typeof item.json._fuzzyScore).toBe('number');
			expect(item.json).toHaveProperty('_wordMatches');
			expect(item.json._wordMatches).toBe(1);
		}
	});

	it('should match items containing any of the words when matchIndividualWords is true', async () => {
		const inputData: INodeExecutionData[] = [
			{ json: { name: 'Apple iPhone 14', price: 999 } },
			{ json: { name: 'Samsung Galaxy S23', price: 899 } },
			{ json: { name: 'Apple MacBook Pro', price: 2499 } },
			{ json: { name: 'Dell Laptop', price: 1299 } },
		];

		const parameters = buildSearchAcrossItemsParams({
			query: 'apple samsung',
			searchKeys: 'name',
			matchQuality: 70,
			includeScore: false,
			matchIndividualWords: true,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
		expect(result[0].length).toBe(3);

		const names = result[0].map((item) => item.json.name);
		expect(names).toContain('Apple iPhone 14');
		expect(names).toContain('Samsung Galaxy S23');
		expect(names).toContain('Apple MacBook Pro');
		expect(names).not.toContain('Dell Laptop');
	});

	it('should rank items with more word matches higher', async () => {
		const inputData: INodeExecutionData[] = [
			{ json: { description: 'red apple fruit' } },
			{ json: { description: 'green apple tree' } },
			{ json: { description: 'red cherry fruit' } },
			{ json: { description: 'banana fruit' } },
		];

		const parameters = buildSearchAcrossItemsParams({
			query: 'red apple',
			searchKeys: 'description',
			matchQuality: 50,
			includeScore: false,
			matchIndividualWords: true,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
		expect(result[0].length).toBeGreaterThanOrEqual(1);
		expect(result[0][0].json.description).toBe('red apple fruit');
	});

	it('should work with matchIndividualWords in array mode', async () => {
		const inputData: INodeExecutionData[] = [
			{
				json: {
					products: [
						{ name: 'iPhone 14 Pro', brand: 'Apple' },
						{ name: 'Galaxy S23', brand: 'Samsung' },
						{ name: 'MacBook Air', brand: 'Apple' },
						{ name: 'ThinkPad X1', brand: 'Lenovo' },
					],
				},
			},
		];

		const parameters = buildSearchInArrayParams('products', {
			query: 'iPhone MacBook',
			searchKeys: 'name',
			matchQuality: 70,
			includeScore: false,
			matchIndividualWords: true,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(1);

		const products = result[0][0].json.products as any[];
		expect(products.length).toBe(2);

		const names = products.map((p: any) => p.name);
		expect(names).toContain('iPhone 14 Pro');
		expect(names).toContain('MacBook Air');
	});

	it('should match with partial word matches when matchIndividualWords is true', async () => {
		const inputData: INodeExecutionData[] = [
			{ json: { name: 'Application Developer' } },
			{ json: { name: 'Web Designer' } },
			{ json: { name: 'Product Manager' } },
			{ json: { name: 'Applied Mathematics' } },
		];

		const parameters = buildSearchAcrossItemsParams({
			query: 'app manager',
			searchKeys: 'name',
			matchQuality: 50,
			includeScore: false,
			matchIndividualWords: true,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
		expect(result[0].length).toBeGreaterThanOrEqual(2);

		const names = result[0].map((item) => item.json.name);
		expect(names).toContain('Application Developer');
		expect(names).toContain('Product Manager');
	});

});

