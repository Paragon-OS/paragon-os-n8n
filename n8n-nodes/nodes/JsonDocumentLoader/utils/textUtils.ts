import { get } from 'lodash';

/**
 * Converts an object key from camelCase/snake_case to a readable label.
 * Example: "displayName" → "Display Name", "user_id" → "User Id"
 */
export function keyToLabel(key: string): string {
	return key
		.replace(/([A-Z])/g, ' $1') // Add space before capitals
		.replace(/_/g, ' ') // Replace underscores with spaces
		.split(' ')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(' ')
		.trim();
}

/**
 * Converts a JSON object to human-readable text optimized for embeddings.
 * Preserves semantic structure while creating searchable text.
 */
export function objectToReadableText(obj: unknown, prefix = ''): string {
	if (obj === null || obj === undefined) return '';
	if (typeof obj !== 'object') return String(obj);

	const lines: string[] = [];

	for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
		const label = keyToLabel(key);

		if (Array.isArray(value)) {
			// Handle arrays of primitives
			if (value.length > 0 && typeof value[0] !== 'object') {
				lines.push(`${prefix}${label}: ${value.join(', ')}`);
			}
			// Skip nested object arrays - they should be split separately
		} else if (typeof value === 'object' && value !== null) {
			// Recurse into nested objects
			lines.push(`${prefix}${label}:`);
			const nestedText = objectToReadableText(value, prefix + '  ');
			if (nestedText) {
				lines.push(nestedText);
			}
		} else if (value !== null && value !== undefined && value !== '') {
			lines.push(`${prefix}${label}: ${value}`);
		}
	}

	return lines.join('\n');
}

/**
 * Applies a template string with {{ fieldName }} placeholders to an object.
 * Supports dot notation for nested fields: {{ user.name }}
 */
export function applyTemplate(template: string, obj: unknown): string {
	return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, path: string) => {
		const value = get(obj, path.trim());
		return value !== undefined && value !== null ? String(value) : '';
	});
}

/**
 * Converts a JSON object to dense text optimized for semantic search.
 * No labels, just values concatenated - cleaner signal for embeddings.
 * Example: { displayName: "Pasindu Lanka", username: "ap_lanka", phone: "123" }
 *       → "Pasindu Lanka ap_lanka 123"
 */
export function objectToDenseText(obj: unknown): string {
	if (obj === null || obj === undefined) return '';
	if (typeof obj !== 'object') return String(obj);

	const values: string[] = [];

	for (const [, value] of Object.entries(obj as Record<string, unknown>)) {
		if (Array.isArray(value)) {
			// Handle arrays of primitives
			if (value.length > 0 && typeof value[0] !== 'object') {
				values.push(value.join(' '));
			}
		} else if (typeof value === 'object' && value !== null) {
			// Recurse into nested objects
			const nestedText = objectToDenseText(value);
			if (nestedText) {
				values.push(nestedText);
			}
		} else if (value !== null && value !== undefined && value !== '') {
			values.push(String(value));
		}
	}

	return values.join(' ');
}

/**
 * Text format types supported by the document loader.
 */
export type TextFormat = 'readable' | 'dense' | 'json' | 'template';

/**
 * Converts an object to text based on the specified format.
 */
export function formatObjectAsText(
	obj: unknown,
	format: TextFormat,
	template?: string,
): string {
	switch (format) {
		case 'readable':
			return objectToReadableText(obj);
		case 'dense':
			return objectToDenseText(obj);
		case 'json':
			return JSON.stringify(obj);
		case 'template':
			return template ? applyTemplate(template, obj) : JSON.stringify(obj);
		default:
			return objectToReadableText(obj);
	}
}

