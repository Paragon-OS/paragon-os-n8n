import MiniSearch from 'minisearch';
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
		displayName: 'FuzzySearch',
		name: 'fuzzySearch',
		icon: 'file:FuzzySearch.svg',
		group: ['transform'],
		version: 1,
		description: 'Perform fuzzy search on strings or objects (v1.4)',
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
				default: 'searchInArray',
				description: 'How to handle input data for searching',
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				default: '',
				required: true,
				description: 'The search query text',
				placeholder: 'apple iphone',
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
				description: 'JSON path to the array field to search in. Supports dot notation for nested fields.',
				placeholder: 'items',
			},
			{
				displayName: '💡 Tip: Use dot notation for nested arrays (e.g., "data.products")',
				name: 'arrayFieldNotice',
				type: 'notice',
				displayOptions: {
					show: {
						searchMode: ['searchInArray'],
					},
				},
				default: '',
			},
			{
				displayName: 'Search Keys',
				name: 'searchKeys',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				description: 'Field names to search in. Supports dot notation for nested fields. Leave empty to search all fields.',
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
					numberStepSize: 10,
				},
				default: 70,
				description: 'Minimum match quality threshold. Higher values = stricter matching.',
			},
			{
				displayName: '💡 100% = perfect match only | 90%+ = very strict | 70% = balanced (recommended) | 50% = lenient | 0% = accept all',
				name: 'matchQualityNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'options',
				options: [
					{ name: '10 Results', value: 10 },
					{ name: '25 Results', value: 25 },
					{ name: '50 Results', value: 50 },
					{ name: '100 Results', value: 100 },
					{ name: 'All Results', value: 0 },
					{ name: 'Custom', value: -1 },
				],
				default: 50,
				description: 'Maximum number of results to return',
			},
			{
				displayName: 'Custom Limit',
				name: 'customLimit',
				type: 'number',
				displayOptions: {
					show: {
						limit: [-1],
					},
				},
				typeOptions: {
					minValue: 1,
				},
				default: 50,
				description: 'Enter a custom limit value',
			},
			{
				displayName: 'Advanced Options',
				name: 'advancedOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Keep Only Set',
						name: 'keepOnlySet',
						type: 'boolean',
						default: false,
						description: 'Whether to keep only the values set on this node and remove all others',
					},
					{
						displayName: 'Include Match Score',
						name: 'includeScore',
						type: 'boolean',
						default: false,
						description: 'Whether to add _fuzzyScore field to results (0-1 scale, higher = better match)',
					},
					{
						displayName: 'Match Individual Words',
						name: 'matchIndividualWords',
						type: 'boolean',
						default: false,
						description: 'Whether to split query into words and match any of them (e.g., "apple iphone" matches items with "apple" OR "iphone")',
					},
				],
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
			
			// Handle limit with custom option
			let limit = this.getNodeParameter('limit', itemIndex) as number;
			if (limit === -1) {
				limit = this.getNodeParameter('customLimit', itemIndex) as number;
			}
			
			// Get advanced options
			const advancedOptions = this.getNodeParameter('advancedOptions', itemIndex, {}) as IDataObject;
			const keepOnlySet = advancedOptions.keepOnlySet as boolean || false;
			const includeScore = advancedOptions.includeScore as boolean || false;
			const matchIndividualWords = advancedOptions.matchIndividualWords as boolean || false;

			// Convert match quality percentage (0-100) to minisearch fuzzy level (0.0 to 1.0)
			// MiniSearch fuzzy: higher = more lenient, lower = stricter
			// Match quality: higher = stricter, lower = more lenient
			// We use a conversion that allows substring matching for moderate matchQuality values
			// MiniSearch requires higher fuzzy levels (0.6+) for substring matching
			// 100% match quality = 0.0 fuzzy (very strict, exact match only)
			// 70% match quality = 0.3 fuzzy (balanced)
			// 50% match quality = 0.5 fuzzy -> adjusted to 0.6 for substring matching
			// 30% match quality = 0.7 fuzzy (very lenient)
			// 0% match quality = 1.0 fuzzy (very lenient, accept anything)
			// Use a formula that ensures matchQuality 50 gives fuzzy 0.6+ for substring matching
			const baseFuzzyLevel = matchQuality === 100 ? 0 : 1 - (matchQuality / 100);
			// Boost fuzzy level for moderate matchQuality to enable substring matching
			const fuzzyLevel = matchQuality <= 50 && matchQuality > 0 
				? Math.min(1, baseFuzzyLevel + 0.1) 
				: baseFuzzyLevel;

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

				// Create MiniSearch index
				const miniSearch = new MiniSearch({
					fields: ['searchableText'],
					storeFields: ['item', 'index', 'searchableText'],
					idField: 'index',
					searchOptions: {
						boost: { searchableText: 1 },
					},
				});

				// Index all search targets
				miniSearch.addAll(searchTargets);

				// Perform fuzzy search with progressive fuzzy level increasing
				let results: any[];
				let usedFallbackThreshold = false;

				if (matchIndividualWords) {
					// Split query into individual words and search for each
					const words = query.trim().split(/\s+/).filter(w => w.length > 0);
					const matchedItemsMap = new Map<number, { item: any; scores: number[]; totalScore: number }>();

					for (const word of words) {
						const wordResults = miniSearch.search(word, {
							fuzzy: fuzzyLevel,
							prefix: fuzzyLevel > 0.5, // Only use prefix for lenient searches
						});

					// Track matches per item
					for (const result of wordResults) {
						const itemIndex = result.id;
						const searchTarget = searchTargets[itemIndex];
						if (!matchedItemsMap.has(itemIndex)) {
							matchedItemsMap.set(itemIndex, {
								item: searchTarget,
								scores: [],
								totalScore: 0,
							});
						}
						const matchInfo = matchedItemsMap.get(itemIndex)!;
						// Ensure score is a number (MiniSearch returns numeric scores)
						const score = typeof result.score === 'number' ? result.score : 0;
						matchInfo.scores.push(score);
						matchInfo.totalScore += score;
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

					// If no results, try with increased fuzzy level (more lenient)
					// Skip fallback if matchQuality is 100 (perfect match only)
					if (results.length === 0 && searchTargets.length > 0 && matchQuality < 100) {
						const fallbackFuzzyLevels = [
							Math.min(1, fuzzyLevel + 0.2),
							Math.min(1, fuzzyLevel + 0.4),
							Math.min(1, fuzzyLevel + 0.6),
							1.0, // Maximum fuzziness
						];
						for (const fallbackFuzzy of fallbackFuzzyLevels) {
							const fallbackResults = miniSearch.search(words[0] || query, {
								fuzzy: fallbackFuzzy,
								prefix: fallbackFuzzy > 0.5, // Only use prefix for lenient searches
							});
							if (fallbackResults.length > 0) {
								const fallbackTarget = searchTargets[fallbackResults[0].id];
								const fallbackScore = typeof fallbackResults[0].score === 'number' ? fallbackResults[0].score : 0;
								results = [{
									obj: fallbackTarget,
									score: fallbackScore,
									_wordMatches: 1
								}];
								usedFallbackThreshold = true;
								break;
							}
						}
					}
				} else {
					// Single query search
					const searchResults = miniSearch.search(query, {
						fuzzy: fuzzyLevel,
						prefix: fuzzyLevel > 0.5, // Only use prefix for lenient searches
					});

					// Transform results to match expected format
					// Filter by minimum score threshold for stricter matching
					// Only apply for matchQuality 30 (not 50, as 50 is used for substring matching)
					// This helps filter out very poor fuzzy matches that fuzzysort would have excluded
					const minScore = (matchQuality === 30) ? 0.7 : 0;
					results = searchResults
						.filter((result: any) => {
							const score = typeof result.score === 'number' ? result.score : 0;
							return score >= minScore;
						})
						.map((result: any) => {
							const searchTarget = searchTargets[result.id];
							// MiniSearch returns score as a number (higher is better)
							// Ensure score is always a number, default to 0 if missing
							const score = typeof result.score === 'number' ? result.score : (result.match || {}).score || 0;
							return {
								obj: searchTarget,
								score: score,
							};
						});

					// Apply limit
					if (limit > 0 && results.length > limit) {
						results = results.slice(0, limit);
					}

					// If no results and we have search targets, progressively increase fuzzy level to get at least one result
					// Skip fallback if matchQuality is 100 (perfect match only)
					if (results.length === 0 && searchTargets.length > 0 && matchQuality < 100) {
						const fallbackFuzzyLevels = [
							Math.min(1, fuzzyLevel + 0.2),
							Math.min(1, fuzzyLevel + 0.4),
							Math.min(1, fuzzyLevel + 0.6),
							1.0, // Maximum fuzziness
						];
						for (const fallbackFuzzy of fallbackFuzzyLevels) {
							const fallbackResults = miniSearch.search(query, {
								fuzzy: fallbackFuzzy,
								prefix: fallbackFuzzy > 0.5, // Only use prefix for lenient searches
							});
							if (fallbackResults.length > 0) {
								const fallbackTarget = searchTargets[fallbackResults[0].id];
								const fallbackScore = typeof fallbackResults[0].score === 'number' ? fallbackResults[0].score : 0;
								results = [{
									obj: fallbackTarget,
									score: fallbackScore,
								}];
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
					// Ensure score is always a number
					const score = typeof result.score === 'number' && !isNaN(result.score) ? result.score : 0;
					newItemJson._fuzzyScore = score;
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

			// Create MiniSearch index
			const miniSearch = new MiniSearch({
				fields: ['searchableText'],
				storeFields: ['element', 'index', 'searchableText'],
				idField: 'index',
				searchOptions: {
					boost: { searchableText: 1 },
				},
			});

			// Index all search targets
			miniSearch.addAll(searchTargets);

			// Perform fuzzy search with progressive fuzzy level increasing
			let results: any[];
			let usedFallbackThreshold = false;

			if (matchIndividualWords) {
				// Split query into individual words and search for each
				const words = query.trim().split(/\s+/).filter(w => w.length > 0);
				const matchedElementsMap = new Map<number, { element: any; scores: number[]; totalScore: number }>();

				for (const word of words) {
					const wordResults = miniSearch.search(word, {
						fuzzy: fuzzyLevel,
						prefix: fuzzyLevel > 0.5, // Only use prefix for lenient searches
					});

					// Track matches per element
					for (const result of wordResults) {
						const elementIndex = result.id;
						const searchTarget = searchTargets[elementIndex];
						if (!matchedElementsMap.has(elementIndex)) {
							matchedElementsMap.set(elementIndex, {
								element: searchTarget,
								scores: [],
								totalScore: 0,
							});
						}
						const matchInfo = matchedElementsMap.get(elementIndex)!;
						// Ensure score is a number (MiniSearch returns numeric scores)
						const score = typeof result.score === 'number' ? result.score : 0;
						matchInfo.scores.push(score);
						matchInfo.totalScore += score;
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

				// If no results, try with increased fuzzy level (more lenient)
				// Skip fallback if matchQuality is 100 (perfect match only)
				if (results.length === 0 && searchTargets.length > 0 && matchQuality < 100) {
					const fallbackFuzzyLevels = [
						Math.min(1, fuzzyLevel + 0.2),
						Math.min(1, fuzzyLevel + 0.4),
						Math.min(1, fuzzyLevel + 0.6),
						1.0, // Maximum fuzziness
					];
					for (const fallbackFuzzy of fallbackFuzzyLevels) {
						const fallbackResults = miniSearch.search(words[0] || query, {
							fuzzy: fallbackFuzzy,
							prefix: true,
						});
						if (fallbackResults.length > 0) {
							const fallbackTarget = searchTargets[fallbackResults[0].id];
							const fallbackScore = typeof fallbackResults[0].score === 'number' ? fallbackResults[0].score : 0;
							results = [{
								obj: fallbackTarget,
								score: fallbackScore,
								_wordMatches: 1
							}];
							usedFallbackThreshold = true;
							break;
						}
					}
				}
			} else {
				// Single query search
				const searchResults = miniSearch.search(query, {
					fuzzy: fuzzyLevel,
					prefix: fuzzyLevel > 0.5, // Only use prefix for lenient searches
				});

				// Transform results to match expected format
				// Filter by minimum score threshold for stricter matching
				// Only apply for matchQuality 30 (not 50, as 50 is used for substring matching)
				// This helps filter out very poor fuzzy matches that fuzzysort would have excluded
				// MiniSearch scores are typically 0-2+, with higher being better
				const minScore = (matchQuality === 30) ? 0.7 : 0;
				results = searchResults
					.filter((result: any) => {
						const score = typeof result.score === 'number' ? result.score : 0;
						return score >= minScore;
					})
					.map((result: any) => {
						const searchTarget = searchTargets[result.id];
						// Ensure score is a number (MiniSearch returns numeric scores)
						const score = typeof result.score === 'number' ? result.score : 0;
						return {
							obj: searchTarget,
							score: score,
						};
					});

				// Apply limit
				if (limit > 0 && results.length > limit) {
					results = results.slice(0, limit);
				}

				// If no results and we have search targets, progressively increase fuzzy level to get at least one result
				// Skip fallback if matchQuality is 100 (perfect match only)
				if (results.length === 0 && searchTargets.length > 0 && matchQuality < 100) {
					const fallbackFuzzyLevels = [
						Math.min(1, fuzzyLevel + 0.2),
						Math.min(1, fuzzyLevel + 0.4),
						Math.min(1, fuzzyLevel + 0.6),
						1.0, // Maximum fuzziness
					];
					for (const fallbackFuzzy of fallbackFuzzyLevels) {
						const fallbackResults = miniSearch.search(query, {
							fuzzy: fallbackFuzzy,
							prefix: true,
						});
						if (fallbackResults.length > 0) {
							const fallbackTarget = searchTargets[fallbackResults[0].id];
							const fallbackScore = typeof fallbackResults[0].score === 'number' ? fallbackResults[0].score : 0;
							results = [{
								obj: fallbackTarget,
								score: fallbackScore,
							}];
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

