import { describe, it, expect, beforeEach } from 'vitest';
import { FuzzySearch } from '../FuzzySearch.node';
import type { INodeExecutionData } from 'n8n-workflow';
import {
	createMockExecuteFunctions,
	buildSearchAcrossItemsParams,
	buildSearchInArrayParams,
	TestDataFactory,
} from '../FuzzySearch.test.helpers';

describe('FuzzySearch - Search All Fields (Empty Search Keys)', () => {
	let fuzzySearchNode: FuzzySearch;

	beforeEach(() => {
		fuzzySearchNode = new FuzzySearch();
	});

	it('should search across all fields when searchKeys is empty', async () => {
		const inputData: INodeExecutionData[] = [
			{ json: { name: 'John', email: 'john@example.com', city: 'New York' } },
			{ json: { name: 'Jane', email: 'jane@example.com', city: 'San Francisco' } },
			{ json: { name: 'Bob', email: 'bob@example.com', city: 'Boston' } },
		];

		const parameters = buildSearchAcrossItemsParams({
			query: 'Francisco',
			searchKeys: '',
			matchQuality: 70,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(1);
		expect(result[0][0].json.name).toBe('Jane');
	});

	it('should search nested objects when searchKeys is empty', async () => {
		const inputData: INodeExecutionData[] = [
			{
				json: {
					name: 'Product A',
					details: {
						manufacturer: 'Apple Inc',
						category: 'Electronics',
					},
				},
			},
			{
				json: {
					name: 'Product B',
					details: {
						manufacturer: 'Samsung',
						category: 'Electronics',
					},
				},
			},
		];

		const parameters = buildSearchAcrossItemsParams({
			query: 'Apple',
			searchKeys: '',
			matchQuality: 70,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(1);
		expect(result[0][0].json.name).toBe('Product A');
	});

	it('should search all fields in array elements when searchKeys is empty', async () => {
		const inputData = TestDataFactory.withArrayField('products', [
			{ id: 1, name: 'Laptop', brand: 'Dell', price: 999 },
			{ id: 2, name: 'Mouse', brand: 'Logitech', price: 29 },
			{ id: 3, name: 'Keyboard', brand: 'Apple', price: 129 },
		]);

		const parameters = buildSearchInArrayParams('products', {
			query: 'Logitech',
			searchKeys: '',
			matchQuality: 70,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(1);

		const products = result[0][0].json.products as any[];
		expect(products).toHaveLength(1);
		expect(products[0].name).toBe('Mouse');
	});

	it('should search arrays within objects when searchKeys is empty', async () => {
		const inputData: INodeExecutionData[] = [
			{
				json: {
					name: 'User A',
					tags: ['developer', 'designer', 'manager'],
				},
			},
			{
				json: {
					name: 'User B',
					tags: ['analyst', 'researcher'],
				},
			},
		];

		const parameters = buildSearchAcrossItemsParams({
			query: 'designer',
			searchKeys: '',
			matchQuality: 70,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(1);
		expect(result[0][0].json.name).toBe('User A');
	});

	it('should search nested objects within array elements when searchKeys is empty', async () => {
		const inputData = TestDataFactory.withArrayField('orders', [
			{
				id: 1,
				customer: {
					name: 'Alice Smith',
					email: 'alice@example.com',
				},
				items: ['laptop', 'mouse'],
			},
			{
				id: 2,
				customer: {
					name: 'Bob Johnson',
					email: 'bob@example.com',
				},
				items: ['keyboard'],
			},
		]);

		const parameters = buildSearchInArrayParams('orders', {
			query: 'Alice',
			searchKeys: '',
			matchQuality: 70,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(1);

		const orders = result[0][0].json.orders as any[];
		expect(orders).toHaveLength(1);
		expect(orders[0].id).toBe(1);
		expect(orders[0].customer.name).toBe('Alice Smith');
	});

	it('should search nested arrays within array elements when searchKeys is empty', async () => {
		const inputData = TestDataFactory.withArrayField('orders', [
			{
				id: 1,
				customer: 'John',
				items: ['laptop', 'mouse', 'keyboard'],
			},
			{
				id: 2,
				customer: 'Jane',
				items: ['tablet', 'stylus'],
			},
		]);

		const parameters = buildSearchInArrayParams('orders', {
			query: 'stylus',
			searchKeys: '',
			matchQuality: 70,
		});

		const mockContext = createMockExecuteFunctions(inputData, parameters);
		const result = await fuzzySearchNode.execute.call(mockContext);

		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(1);

		const orders = result[0][0].json.orders as any[];
		expect(orders).toHaveLength(1);
		expect(orders[0].id).toBe(2);
	});
});

