import { vi } from 'vitest';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

/**
 * Parameters for creating a mock execution context
 */
export interface MockExecutionParams {
	inputData: INodeExecutionData[];
	searchMode: 'searchAcrossItems' | 'searchInArray';
	query: string;
	searchKeys?: string;
	matchQuality?: number;
	limit?: number;
	keepOnlySet?: boolean;
	includeScore?: boolean;
	matchIndividualWords?: boolean;
	arrayField?: string;
}

/**
 * Default parameter values for tests
 */
export const DEFAULT_PARAMS = {
	searchKeys: '',
	matchQuality: 70,
	limit: 50,
	keepOnlySet: false,
	includeScore: false,
	matchIndividualWords: false,
};

/**
 * Creates a mock IExecuteFunctions for testing
 */
export function createMockExecuteFunctions(
	inputData: INodeExecutionData[],
	parameters: Record<string, any>,
): IExecuteFunctions {
	return {
		getInputData: () => inputData,
		getNodeParameter: (parameterName: string, itemIndex: number, fallbackValue?: any) => {
			const value = parameters[parameterName];
			return value !== undefined ? value : fallbackValue;
		},
		getNode: () => ({
			name: 'FuzzySearch',
			typeVersion: 1,
			type: 'n8n-nodes-base.fuzzySearch',
			position: [0, 0],
			parameters: {},
		}),
		prepareOutputData: (data: INodeExecutionData[]) => [data],
		helpers: {} as any,
		continueOnFail: () => false,
		evaluateExpression: vi.fn(),
		executeWorkflow: vi.fn(),
		getContext: vi.fn(),
		getCredentials: vi.fn(),
		getExecuteData: vi.fn(),
		getExecuteFunctions: vi.fn(),
		getExecutePollFunctions: vi.fn(),
		getExecuteSingleFunctions: vi.fn(),
		getExecuteTriggerFunctions: vi.fn(),
		getExecuteWebhookFunctions: vi.fn(),
		getInputConnectionData: vi.fn(),
		getMode: vi.fn(),
		getNodeOutputs: vi.fn(),
		getParentCallbackManager: vi.fn(),
		getRestApiUrl: vi.fn(),
		getTimezone: vi.fn(),
		getWebhookDescription: vi.fn(),
		getWebhookName: vi.fn(),
		getWorkflow: vi.fn(),
		getWorkflowDataProxy: vi.fn(),
		getWorkflowStaticData: vi.fn(),
		logNodeOutput: vi.fn(),
		sendMessageToUI: vi.fn(),
		getExecutionId: vi.fn(),
		startJob: vi.fn(),
		getInputSourceData: vi.fn(),
	} as unknown as IExecuteFunctions;
}

/**
 * Builds parameters for search across items mode
 */
export function buildSearchAcrossItemsParams(
	overrides: Partial<Omit<MockExecutionParams, 'inputData' | 'searchMode' | 'arrayField'>> = {},
): Record<string, any> {
	return {
		searchMode: 'searchAcrossItems',
		query: overrides.query ?? '',
		searchKeys: overrides.searchKeys ?? DEFAULT_PARAMS.searchKeys,
		matchQuality: overrides.matchQuality ?? DEFAULT_PARAMS.matchQuality,
		limit: overrides.limit ?? DEFAULT_PARAMS.limit,
		advancedOptions: {
			keepOnlySet: overrides.keepOnlySet ?? DEFAULT_PARAMS.keepOnlySet,
			includeScore: overrides.includeScore ?? DEFAULT_PARAMS.includeScore,
			matchIndividualWords: overrides.matchIndividualWords ?? DEFAULT_PARAMS.matchIndividualWords,
		},
	};
}

/**
 * Builds parameters for search in array mode
 */
export function buildSearchInArrayParams(
	arrayField: string,
	overrides: Partial<Omit<MockExecutionParams, 'inputData' | 'searchMode' | 'arrayField'>> = {},
): Record<string, any> {
	return {
		searchMode: 'searchInArray',
		arrayField,
		query: overrides.query ?? '',
		searchKeys: overrides.searchKeys ?? DEFAULT_PARAMS.searchKeys,
		matchQuality: overrides.matchQuality ?? DEFAULT_PARAMS.matchQuality,
		limit: overrides.limit ?? DEFAULT_PARAMS.limit,
		advancedOptions: {
			keepOnlySet: overrides.keepOnlySet ?? DEFAULT_PARAMS.keepOnlySet,
			includeScore: overrides.includeScore ?? DEFAULT_PARAMS.includeScore,
			matchIndividualWords: overrides.matchIndividualWords ?? DEFAULT_PARAMS.matchIndividualWords,
		},
	};
}

/**
 * Test data factories
 */
export const TestDataFactory = {
	/**
	 * Creates simple user data
	 */
	users: (count: number = 3): INodeExecutionData[] => [
		{ json: { name: 'John Doe', email: 'john@example.com' } },
		{ json: { name: 'Jane Smith', email: 'jane@example.com' } },
		{ json: { name: 'Bob Johnson', email: 'bob@example.com' } },
	].slice(0, count),

	/**
	 * Creates product data
	 */
	products: (): INodeExecutionData[] => [
		{ json: { name: 'Apple', category: 'Fruit', price: 1.5 } },
		{ json: { name: 'Banana', category: 'Fruit', price: 0.5 } },
		{ json: { name: 'Carrot', category: 'Vegetable', price: 0.8 } },
	],

	/**
	 * Creates data with nested objects
	 */
	nestedUsers: (): INodeExecutionData[] => [
		{ json: { user: { name: 'Alice', email: 'alice@example.com' } } },
		{ json: { user: { name: 'Bob', email: 'bob@example.com' } } },
		{ json: { user: { name: 'Charlie', email: 'charlie@example.com' } } },
	],

	/**
	 * Creates data with arrays
	 */
	withArrayField: (arrayFieldName: string, items: any[]): INodeExecutionData[] => [
		{
			json: {
				[arrayFieldName]: items,
			},
		},
	],

	/**
	 * Creates programming language data for fuzzy matching tests
	 */
	programmingLanguages: (): INodeExecutionData[] => [
		{ json: { name: 'JavaScript Programming' } },
		{ json: { name: 'JavaScript' } },
		{ json: { name: 'Java Language' } },
		{ json: { name: 'Python Code' } },
	],

	/**
	 * Creates test items
	 */
	testItems: (count: number): INodeExecutionData[] =>
		Array.from({ length: count }, (_, i) => ({
			json: { name: `Test ${i + 1}` },
		})),
};

/**
 * Assertion helpers
 */
export const AssertionHelpers = {
	/**
	 * Asserts that all items have a property
	 */
	allItemsHaveProperty: (items: INodeExecutionData[], property: string) => {
		for (const item of items) {
			if (!item.json.hasOwnProperty(property)) {
				throw new Error(`Expected all items to have property "${property}"`);
			}
		}
	},

	/**
	 * Asserts that no items have a property
	 */
	noItemsHaveProperty: (items: INodeExecutionData[], property: string) => {
		for (const item of items) {
			if (item.json.hasOwnProperty(property)) {
				throw new Error(`Expected no items to have property "${property}"`);
			}
		}
	},

	/**
	 * Extracts values from a field in all items
	 */
	extractField: (items: INodeExecutionData[], field: string): any[] => {
		return items.map((item) => item.json[field]);
	},
};

