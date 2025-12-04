import { get } from 'lodash';

/**
 * Represents a single document extracted from JSON data.
 */
export interface ExtractedDocument {
	text: string;
	metadata: Record<string, unknown>;
}

/**
 * Options for extracting documents from JSON.
 */
export interface ExtractionOptions {
	idField: string;
	includeRawJson: boolean;
	skipEmpty: boolean;
	metadataFields: string[];
}

/**
 * Default extraction options.
 */
export const DEFAULT_EXTRACTION_OPTIONS: ExtractionOptions = {
	idField: 'id',
	includeRawJson: true,
	skipEmpty: true,
	metadataFields: [],
};

/**
 * Finds arrays within an object and returns their items flattened.
 * Only considers arrays of objects (not primitive arrays).
 *
 * @param obj - The object to search for arrays
 * @returns Flattened array of all object items found in arrays
 */
export function findAndFlattenArrays(obj: unknown): unknown[] {
	const results: unknown[] = [];

	// If input is already an array of objects, return as-is
	if (Array.isArray(obj)) {
		if (obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
			return obj;
		}
		return [];
	}

	// Search object properties for arrays
	if (typeof obj === 'object' && obj !== null) {
		for (const value of Object.values(obj as Record<string, unknown>)) {
			if (Array.isArray(value) && value.length > 0) {
				// Only include arrays of objects
				if (typeof value[0] === 'object' && value[0] !== null) {
					results.push(...value);
				}
			}
		}
	}

	return results;
}

/**
 * Extracts the document ID from an object using the specified field.
 * Falls back to index-based ID if field not found.
 */
export function extractDocumentId(
	obj: unknown,
	idField: string,
	fallbackIndex: number,
): string | number {
	const value = get(obj, idField);
	if (value !== undefined && value !== null) {
		return typeof value === 'number' ? value : String(value);
	}
	return `doc_${fallbackIndex}`;
}

/**
 * Extracts specified metadata fields from an object.
 */
export function extractMetadataFields(
	obj: unknown,
	fields: string[],
): Record<string, unknown> {
	const metadata: Record<string, unknown> = {};

	for (const field of fields) {
		const value = get(obj, field);
		if (value !== undefined) {
			metadata[field] = value;
		}
	}

	return metadata;
}

/**
 * Builds a complete metadata object for a document.
 */
export function buildDocumentMetadata(
	obj: unknown,
	index: number,
	options: ExtractionOptions,
): Record<string, unknown> {
	const metadata: Record<string, unknown> = {
		index,
		id: extractDocumentId(obj, options.idField, index),
	};

	// Add extra metadata fields
	const extraFields = extractMetadataFields(obj, options.metadataFields);
	Object.assign(metadata, extraFields);

	// Add raw JSON if requested
	if (options.includeRawJson) {
		metadata.rawJson = JSON.stringify(obj);
	}

	return metadata;
}

/**
 * Parses a comma-separated string into an array of trimmed field names.
 */
export function parseMetadataFieldsString(fieldsString: string): string[] {
	return fieldsString
		.split(',')
		.map((f) => f.trim())
		.filter((f) => f.length > 0);
}

