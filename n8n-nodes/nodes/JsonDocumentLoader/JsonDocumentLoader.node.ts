import { get } from 'lodash';
import { IExecuteFunctions, NodeConnectionType } from 'n8n-workflow';
import {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
	INode,
} from 'n8n-workflow';

import {
	findAndFlattenArrays,
	buildDocumentMetadata,
	parseMetadataFieldsString,
	DEFAULT_EXTRACTION_OPTIONS,
	type ExtractedDocument,
	type ExtractionOptions,
} from './utils/jsonUtils';

import { formatObjectAsText, type TextFormat } from './utils/textUtils';

/**
 * Output modes for the document loader.
 */
type OutputMode = 'batch' | 'multiple';

/**
 * Operation types for splitting JSON data.
 */
type Operation = 'splitArray' | 'autoSplit';

/**
 * Extracts documents from the source data based on operation type.
 */
function extractDocuments(
	node: INode,
	data: unknown,
	operation: Operation,
	textFormat: TextFormat,
	template: string,
	options: ExtractionOptions,
	itemIndex: number,
): ExtractedDocument[] {
	const documents: ExtractedDocument[] = [];

	// Determine items to process based on operation
	let itemsToProcess: unknown[];

	if (operation === 'splitArray') {
		if (!Array.isArray(data)) {
			throw new NodeOperationError(
				node,
				'Source data must be an array for "Split Array" operation. Use "Auto Split" to detect arrays within objects.',
				{ itemIndex },
			);
		}
		itemsToProcess = data;
	} else {
		// autoSplit - find arrays in object
		itemsToProcess = findAndFlattenArrays(data);

		if (itemsToProcess.length === 0) {
			// If no arrays found, treat the whole object as a single document
			itemsToProcess = [data];
		}
	}

	// Process each item into a document
	for (let i = 0; i < itemsToProcess.length; i++) {
		const item = itemsToProcess[i];

		// Generate text based on format
		const text = formatObjectAsText(item, textFormat, template);

		// Skip empty documents if option is set
		if (options.skipEmpty && !text.trim()) {
			continue;
		}

		// Build metadata
		const metadata = buildDocumentMetadata(item, i, options);

		documents.push({ text, metadata });
	}

	return documents;
}

/**
 * Creates a single batch output item containing all documents.
 */
function createBatchOutput(
	documents: ExtractedDocument[],
	itemIndex: number,
): INodeExecutionData {
	const texts = documents.map((d) => d.text);

	return {
		json: {
			documents,
			texts,
			count: documents.length,
			// Pre-formatted for batch embedding APIs
			batchRequest: texts.map((text, i) => ({
				index: i,
				text,
			})),
		},
		pairedItem: { item: itemIndex },
	};
}

/**
 * Creates multiple output items, one per document.
 */
function createMultipleOutputs(
	documents: ExtractedDocument[],
	itemIndex: number,
): INodeExecutionData[] {
	return documents.map((doc) => ({
		json: {
			text: doc.text,
			metadata: doc.metadata,
		},
		pairedItem: { item: itemIndex },
	}));
}

/**
 * JsonDocumentLoader - A node that splits JSON data into batch-ready documents for embedding.
 *
 * Key features:
 * - Splits JSON arrays into individual documents
 * - Auto-detects arrays within objects
 * - Outputs in batch format for efficient embedding API calls
 * - Converts JSON to readable text optimized for embeddings
 */
export class JsonDocumentLoader implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'JSON Document Loader',
		name: 'jsonDocumentLoader',
		icon: 'file:JsonDocumentLoader.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] }}',
		description: 'Split JSON data into batch-ready documents for embedding (v1.0)',
		defaults: {
			name: 'JSON Document Loader',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Split Array',
						value: 'splitArray',
						description: 'Split a JSON array into individual documents',
					},
					{
						name: 'Auto Split',
						value: 'autoSplit',
						description: 'Auto-detect and split arrays within an object',
					},
				],
				default: 'autoSplit',
			},
			{
				displayName: 'Source Field',
				name: 'sourceField',
				type: 'string',
				default: '',
				placeholder: 'data.contacts',
				description:
					'JSON path to the data. Leave empty to use entire input. Supports dot notation.',
			},
			{
				displayName: 'Text Format',
				name: 'textFormat',
				type: 'options',
				options: [
					{
						name: 'Dense (Best for Search)',
						value: 'dense',
						description: 'Values only, no labels - optimal for semantic search',
					},
					{
						name: 'Readable',
						value: 'readable',
						description: 'Human-readable text with field labels',
					},
					{
						name: 'JSON String',
						value: 'json',
						description: 'Raw JSON string',
					},
					{
						name: 'Custom Template',
						value: 'template',
						description: 'Use a custom template with field placeholders',
					},
				],
				default: 'dense',
			},
			{
				displayName: 'Template',
				name: 'template',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				displayOptions: {
					show: {
						textFormat: ['template'],
					},
				},
				default: '{{ displayName }} ({{ username }})\nPhone: {{ phone }}',
				description:
					'Template with {{ fieldName }} placeholders. Supports dot notation for nested fields.',
			},
			{
				displayName: 'Output Mode',
				name: 'outputMode',
				type: 'options',
				options: [
					{
						name: 'Single Batch Item',
						value: 'batch',
						description: 'One output item containing all documents (for batch APIs)',
					},
					{
						name: 'Multiple Items',
						value: 'multiple',
						description: 'Each document as a separate output item',
					},
				],
				default: 'batch',
				hint: 'Use "Single Batch Item" for efficient batch embedding API calls',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Include Raw JSON',
						name: 'includeRawJson',
						type: 'boolean',
						default: true,
						description: 'Whether to include the original JSON in metadata for retrieval',
					},
					{
						displayName: 'ID Field',
						name: 'idField',
						type: 'string',
						default: 'id',
						description: 'Field to use as document ID (supports dot notation)',
						placeholder: 'id, _id, uuid',
					},
					{
						displayName: 'Metadata Fields',
						name: 'metadataFields',
						type: 'string',
						default: '',
						description: 'Additional fields to include in metadata (comma-separated)',
						placeholder: 'type, category, tags',
					},
					{
						displayName: 'Skip Empty',
						name: 'skipEmpty',
						type: 'boolean',
						default: true,
						description: 'Whether to skip items that produce empty text',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const node = this.getNode();

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const operation = this.getNodeParameter('operation', itemIndex) as Operation;
				const sourceField = this.getNodeParameter('sourceField', itemIndex, '') as string;
				const textFormat = this.getNodeParameter('textFormat', itemIndex) as TextFormat;
				const outputMode = this.getNodeParameter('outputMode', itemIndex) as OutputMode;
				const template = this.getNodeParameter('template', itemIndex, '') as string;
				const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

				const item = items[itemIndex];

				// Get source data
				const sourceData = sourceField ? get(item.json, sourceField) : item.json;

				if (sourceData === undefined || sourceData === null) {
					throw new NodeOperationError(
						node,
						sourceField
							? `Source field "${sourceField}" not found or is empty`
							: 'Input data is empty',
						{ itemIndex },
					);
				}

				// Build extraction options
				const extractionOptions: ExtractionOptions = {
					idField: (options.idField as string) || DEFAULT_EXTRACTION_OPTIONS.idField,
					includeRawJson:
						options.includeRawJson !== false
							? DEFAULT_EXTRACTION_OPTIONS.includeRawJson
							: false,
					skipEmpty:
						options.skipEmpty !== false ? DEFAULT_EXTRACTION_OPTIONS.skipEmpty : false,
					metadataFields: parseMetadataFieldsString(
						(options.metadataFields as string) || '',
					),
				};

				// Extract documents
				const documents = extractDocuments(
					node,
					sourceData,
					operation,
					textFormat,
					template,
					extractionOptions,
					itemIndex,
				);

				if (documents.length === 0) {
					continue;
				}

				// Output based on mode
				if (outputMode === 'batch') {
					returnData.push(createBatchOutput(documents, itemIndex));
				} else {
					returnData.push(...createMultipleOutputs(documents, itemIndex));
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: (error as Error).message,
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
