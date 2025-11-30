import * as fuzzysort from 'fuzzysort';
import { get, set } from 'lodash';
import { deepCopy, IExecuteFunctions, NodeConnectionType } from 'n8n-workflow';
import {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

/** A node which allows you to perform fuzzy search on data. */
export class FuzzySearch implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'FuzzySearch v1.3',
		name: 'fuzzySearch',
		icon: 'file:FuzzySearch.svg',
		group: ['transform'],
		version: 1,
		description: 'Perform fuzzy search on strings or objects',
		defaults: {
			name: 'FuzzySearch',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		properties: [
			{
				displayName: 'Search Mode',
				name: 'searchMode',
				type: 'options',
				options: [
					{
						name: 'Search Across Items',
						value: 'searchAcrossItems',
						description: 'Search across all incoming items',
					},
					{
						name: 'Search in Array Field',
						value: 'searchInArray',
						description: 'Search within an array field from incoming JSON',
					},
				],
				default: 'searchAcrossItems',
				description: 'How to handle input data for searching',
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				default: '',
				required: true,
				description: 'The search query text',
				placeholder: 'Search term...',
			},
			{
				displayName: 'Array Field',
				name: 'arrayField',
				type: 'string',
				displayOptions: {
					show: {
						searchMode: ['searchInArray'],
					},
				},
				default: '',
				required: true,
				description: 'JSON path to the array field to search in (e.g., "items" or "data.products")',
				placeholder: 'items',
			},
			{
				displayName: 'Search Keys',
				name: 'searchKeys',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				description: 'Field names to search in, one per line. Leave empty to search entire string/object. Supports dot notation (e.g., "name", "user.email").',
				placeholder: 'name\ndescription\nuser.email',
			},
		{
			displayName: 'Match Quality (%)',
			name: 'matchQuality',
			type: 'number',
			typeOptions: {
				minValue: 0,
				maxValue: 100,
				numberPrecision: 0,
			},
			default: 70,
			description: 'Minimum match quality percentage (0-100%). Higher = stricter. 100% = perfect match only, 90%+ = very strict, 70% = balanced, 50% = lenient, 0% = accept anything.',
			placeholder: '70',
		},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 50,
				description: 'Max number of results to return',
			},
		{
			displayName: 'Keep Only Set',
			name: 'keepOnlySet',
			type: 'boolean',
			default: false,
			description: 'Whether only the values set on this node should be kept and all others removed',
		},
		{
			displayName: 'Include Match Score',
			name: 'includeScore',
			type: 'boolean',
			default: false,
			description: 'Whether to include the match score in the results. Score ranges from 0 (worst) to 1 (perfect match). Higher scores indicate better matches.',
		},
		{
			displayName: 'Match Individual Words',
			name: 'matchIndividualWords',
			type: 'boolean',
			default: false,
			description: 'Whether to split the query into individual words and match any of them. When enabled, "apple iphone" will match items containing either "apple" OR "iphone" or both. Results with more word matches rank higher.',
		},
	],
};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const searchMode = this.getNodeParameter('searchMode', itemIndex) as string;
			const query = this.getNodeParameter('query', itemIndex) as string;
			const searchKeysRaw = this.getNodeParameter('searchKeys', itemIndex, '') as string;
			const matchQuality = this.getNodeParameter('matchQuality', itemIndex) as number;
			const limit = this.getNodeParameter('limit', itemIndex) as number;
			const keepOnlySet = this.getNodeParameter('keepOnlySet', itemIndex) as boolean;
			const includeScore = this.getNodeParameter('includeScore', itemIndex) as boolean;
			const matchIndividualWords = this.getNodeParameter('matchIndividualWords', itemIndex) as boolean;

			// Convert match quality percentage (0-100) to fuzzysort threshold (0.0 to 1.0)
			// Fuzzysort uses positive decimal scores where 1.0 = perfect match
			// 100% = 1.0 (perfect match only)
			// 50% = 0.5 (balanced)
			// 0% = 0.0 (accept anything)
			const threshold = matchQuality / 100;

			const searchKeys = searchKeysRaw
				.split('\n')
				.map((key) => key.trim())
				.filter((key) => key.length > 0);

			const item = items[itemIndex];

			if (searchMode === 'searchAcrossItems') {
				// In this mode, we search across all items
				// We'll process all items at once when itemIndex === 0
				if (itemIndex === 0) {
					const searchTargets: Array<{
						item: INodeExecutionData;
						index: number;
						searchableText: string;
					}> = [];

				// Prepare all items for searching
				for (let i = 0; i < items.length; i++) {
					const currentItem = items[i];
					let searchableText = '';

					if (searchKeys.length === 0) {
						// Search all fields - extract all values from the object
						const extractValues = (obj: any): string[] => {
							const values: string[] = [];
							for (const key in obj) {
								if (obj.hasOwnProperty(key)) {
									const value = obj[key];
									if (value !== undefined && value !== null) {
										if (typeof value === 'object' && !Array.isArray(value)) {
											// Recursively extract from nested objects
											values.push(...extractValues(value));
										} else if (Array.isArray(value)) {
											// Extract from array elements
											for (const item of value) {
												if (typeof item === 'object' && item !== null) {
													values.push(...extractValues(item));
												} else if (item !== null && item !== undefined) {
													values.push(String(item));
												}
											}
										} else {
											values.push(String(value));
										}
									}
								}
							}
							return values;
						};
						searchableText = extractValues(currentItem.json).join(' ');
					} else {
						// Search specific keys
						const textParts: string[] = [];
						for (const key of searchKeys) {
							const value = get(currentItem.json, key);
							if (value !== undefined && value !== null) {
								textParts.push(typeof value === 'string' ? value : JSON.stringify(value));
							}
						}
						searchableText = textParts.join(' ');
					}

					searchTargets.push({
						item: currentItem,
						index: i,
						searchableText,
					});
				}

				// Perform fuzzy search with progressive threshold lowering
				let results: any[];
				let usedFallbackThreshold = false;

				if (matchIndividualWords) {
					// Split query into individual words and search for each
					const words = query.trim().split(/\s+/).filter(w => w.length > 0);
					const matchedItemsMap = new Map<number, { item: any; scores: number[]; totalScore: number }>();

					for (const word of words) {
						const wordResults = fuzzysort.go(word, searchTargets, {
							key: 'searchableText',
							threshold,
						});

						// Track matches per item
						for (const result of wordResults) {
							const itemIndex = result.obj.index;
							if (!matchedItemsMap.has(itemIndex)) {
								matchedItemsMap.set(itemIndex, {
									item: result.obj,
									scores: [],
									totalScore: 0,
								});
							}
							const matchInfo = matchedItemsMap.get(itemIndex)!;
							matchInfo.scores.push(result.score);
							matchInfo.totalScore += result.score;
						}
					}

					// Convert to results array and sort by total score (higher is better)
					results = Array.from(matchedItemsMap.values())
						.map(matchInfo => ({
							obj: matchInfo.item,
							score: matchInfo.totalScore / matchInfo.scores.length, // Average score
							_wordMatches: matchInfo.scores.length, // Track how many words matched
						}))
						.sort((a, b) => {
							// First sort by number of word matches (more is better)
							if (b._wordMatches !== a._wordMatches) {
								return b._wordMatches - a._wordMatches;
							}
							// Then by average score (higher is better)
							return b.score - a.score;
						});

					// Apply limit
					if (limit > 0 && results.length > limit) {
						results = results.slice(0, limit);
					}

					// If no results, try with fallback threshold
					if (results.length === 0 && searchTargets.length > 0) {
						const thresholds = [threshold * 0.8, threshold * 0.6, threshold * 0.4, threshold * 0.2, -1000];
						for (const fallbackThreshold of thresholds) {
							const fallbackResults = fuzzysort.go(words[0] || query, searchTargets, {
								key: 'searchableText',
								threshold: fallbackThreshold,
								limit: 1,
							});
							if (fallbackResults.length > 0) {
								results = [{ obj: fallbackResults[0].obj, score: fallbackResults[0].score, _wordMatches: 1 }];
								usedFallbackThreshold = true;
								break;
							}
						}
					}
				} else {
					// Original single-query search
					results = fuzzysort.go(query, searchTargets, {
						key: 'searchableText',
						threshold,
						limit: limit > 0 ? limit : undefined,
					}) as unknown as any[];

					// If no results and we have search targets, progressively lower threshold to get at least one result
					if (results.length === 0 && searchTargets.length > 0) {
						const thresholds = [threshold * 0.8, threshold * 0.6, threshold * 0.4, threshold * 0.2, -1000];
						for (const fallbackThreshold of thresholds) {
							results = fuzzysort.go(query, searchTargets, {
								key: 'searchableText',
								threshold: fallbackThreshold,
								limit: 1, // Just get the top match
							}) as unknown as any[];
							if (results.length > 0) {
								usedFallbackThreshold = true;
								break;
							}
						}
					}
				}

			// Build return data from results
			for (const result of results) {
				const originalItem = result.obj.item;
				let newItemJson: IDataObject = {};

				if (!keepOnlySet) {
					newItemJson = deepCopy(originalItem.json);
				}

				// Add match score if requested
				if (includeScore) {
					newItemJson._fuzzyScore = result.score;
					newItemJson._isAboveThreshold = !usedFallbackThreshold;
					// Add word match count if using individual word matching
					if (matchIndividualWords && result._wordMatches) {
						newItemJson._wordMatches = result._wordMatches;
					}
				}

				returnData.push({
					json: newItemJson,
					binary: originalItem.binary,
					pairedItem: {
						item: result.obj.index,
					},
				});
			}

					// Since we processed all items, break out of the main loop
					break;
				}
			} else if (searchMode === 'searchInArray') {
				// Search within an array field
				const arrayField = this.getNodeParameter('arrayField', itemIndex) as string;
				const arrayData = get(item.json, arrayField);

				if (!Array.isArray(arrayData)) {
					throw new NodeOperationError(
						this.getNode(),
						`The field "${arrayField}" is not an array or does not exist`,
						{ itemIndex },
					);
				}

				const searchTargets: Array<{
					element: any;
					index: number;
					searchableText: string;
				}> = [];

				// Prepare array elements for searching
				for (let i = 0; i < arrayData.length; i++) {
					const element = arrayData[i];
					let searchableText = '';

					if (typeof element === 'string') {
						searchableText = element;
					} else if (searchKeys.length === 0) {
						// Search all fields - extract all values from the object
						const extractValues = (obj: any): string[] => {
							const values: string[] = [];
							for (const key in obj) {
								if (obj.hasOwnProperty(key)) {
									const value = obj[key];
									if (value !== undefined && value !== null) {
										if (typeof value === 'object' && !Array.isArray(value)) {
											// Recursively extract from nested objects
											values.push(...extractValues(value));
										} else if (Array.isArray(value)) {
											// Extract from array elements
											for (const item of value) {
												if (typeof item === 'object' && item !== null) {
													values.push(...extractValues(item));
												} else if (item !== null && item !== undefined) {
													values.push(String(item));
												}
											}
										} else {
											values.push(String(value));
										}
									}
								}
							}
							return values;
						};
						searchableText = extractValues(element).join(' ');
					} else {
						const textParts: string[] = [];
						for (const key of searchKeys) {
							const value = get(element, key);
							if (value !== undefined && value !== null) {
								textParts.push(typeof value === 'string' ? value : JSON.stringify(value));
							}
						}
						searchableText = textParts.join(' ');
					}

				searchTargets.push({
					element,
					index: i,
					searchableText,
				});
			}

			// Perform fuzzy search with progressive threshold lowering
			let results: any[];
			let usedFallbackThreshold = false;

			if (matchIndividualWords) {
				// Split query into individual words and search for each
				const words = query.trim().split(/\s+/).filter(w => w.length > 0);
				const matchedElementsMap = new Map<number, { element: any; scores: number[]; totalScore: number }>();

				for (const word of words) {
					const wordResults = fuzzysort.go(word, searchTargets, {
						key: 'searchableText',
						threshold,
					});

					// Track matches per element
					for (const result of wordResults) {
						const elementIndex = result.obj.index;
						if (!matchedElementsMap.has(elementIndex)) {
							matchedElementsMap.set(elementIndex, {
								element: result.obj,
								scores: [],
								totalScore: 0,
							});
						}
						const matchInfo = matchedElementsMap.get(elementIndex)!;
						matchInfo.scores.push(result.score);
						matchInfo.totalScore += result.score;
					}
				}

				// Convert to results array and sort by total score (higher is better)
				results = Array.from(matchedElementsMap.values())
					.map(matchInfo => ({
						obj: matchInfo.element,
						score: matchInfo.totalScore / matchInfo.scores.length, // Average score
						_wordMatches: matchInfo.scores.length, // Track how many words matched
					}))
					.sort((a, b) => {
						// First sort by number of word matches (more is better)
						if (b._wordMatches !== a._wordMatches) {
							return b._wordMatches - a._wordMatches;
						}
						// Then by average score (higher is better)
						return b.score - a.score;
					});

				// Apply limit
				if (limit > 0 && results.length > limit) {
					results = results.slice(0, limit);
				}

				// If no results, try with fallback threshold
				if (results.length === 0 && searchTargets.length > 0) {
					const thresholds = [threshold * 0.8, threshold * 0.6, threshold * 0.4, threshold * 0.2, -1000];
					for (const fallbackThreshold of thresholds) {
						const fallbackResults = fuzzysort.go(words[0] || query, searchTargets, {
							key: 'searchableText',
							threshold: fallbackThreshold,
							limit: 1,
						});
						if (fallbackResults.length > 0) {
							results = [{ obj: fallbackResults[0].obj, score: fallbackResults[0].score, _wordMatches: 1 }];
							usedFallbackThreshold = true;
							break;
						}
					}
				}
			} else {
				// Original single-query search
				results = fuzzysort.go(query, searchTargets, {
					key: 'searchableText',
					threshold,
					limit: limit > 0 ? limit : undefined,
				}) as unknown as any[];

				// If no results and we have search targets, progressively lower threshold to get at least one result
				if (results.length === 0 && searchTargets.length > 0) {
					const thresholds = [threshold * 0.8, threshold * 0.6, threshold * 0.4, threshold * 0.2, -1000];
					for (const fallbackThreshold of thresholds) {
						results = fuzzysort.go(query, searchTargets, {
							key: 'searchableText',
							threshold: fallbackThreshold,
							limit: 1, // Just get the top match
						}) as unknown as any[];
						if (results.length > 0) {
							usedFallbackThreshold = true;
							break;
						}
					}
				}
			}

			// Build filtered array
				const filteredArray = results.map((result) => {
					const element = result.obj.element;
					
					// If includeScore is enabled and element is an object, add the score
					if (includeScore && typeof element === 'object' && element !== null && !Array.isArray(element)) {
						const scoreMetadata: IDataObject = {
							...element,
							_fuzzyScore: result.score,
							_isAboveThreshold: !usedFallbackThreshold,
						};
						// Add word match count if using individual word matching
						if (matchIndividualWords && result._wordMatches) {
							scoreMetadata._wordMatches = result._wordMatches;
						}
						return scoreMetadata;
					}
					
					return element;
				});

				// Create new item with filtered array
				let newItemJson: IDataObject = {};

				if (!keepOnlySet) {
					newItemJson = deepCopy(item.json);
				}

				set(newItemJson, arrayField, filteredArray);
				
				// For array search, also add score info at the item level if requested
				if (includeScore) {
					newItemJson._fuzzyScoreInfo = {
						totalMatches: results.length,
						topScore: results.length > 0 ? results[0].score : null,
						isAboveThreshold: !usedFallbackThreshold,
					};
				}

				returnData.push({
					json: newItemJson,
					binary: item.binary,
					pairedItem: {
						item: itemIndex,
					},
				});
			} else {
				throw new NodeOperationError(
					this.getNode(),
					'searchAcrossItems or searchInArray are valid options',
					{ itemIndex },
				);
			}
		}

		return this.prepareOutputData(returnData);
	}
}

