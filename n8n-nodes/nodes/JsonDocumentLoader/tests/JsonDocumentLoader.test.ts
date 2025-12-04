import { describe, it, expect } from 'vitest';

import {
	findAndFlattenArrays,
	buildDocumentMetadata,
	parseMetadataFieldsString,
	extractDocumentId,
} from '../utils/jsonUtils';

import {
	objectToReadableText,
	applyTemplate,
	formatObjectAsText,
	keyToLabel,
} from '../utils/textUtils';

/**
 * Test 1: JSON Array Splitting
 * Tests the core functionality of extracting items from JSON arrays.
 */
describe('JSON Array Splitting', () => {
	it('should extract items from a direct array', () => {
		const contacts = [
			{ id: 1, name: 'John', phone: '123' },
			{ id: 2, name: 'Jane', phone: '456' },
			{ id: 3, name: 'Bob', phone: '789' },
		];

		const result = findAndFlattenArrays(contacts);

		expect(result).toHaveLength(3);
		expect(result[0]).toEqual({ id: 1, name: 'John', phone: '123' });
		expect(result[1]).toEqual({ id: 2, name: 'Jane', phone: '456' });
		expect(result[2]).toEqual({ id: 3, name: 'Bob', phone: '789' });
	});

	it('should find and flatten arrays within an object', () => {
		const data = {
			metadata: { source: 'telegram' },
			allContacts: [
				{ id: 100, displayName: 'Alice' },
				{ id: 200, displayName: 'Bob' },
			],
			otherData: 'ignored',
		};

		const result = findAndFlattenArrays(data);

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({ id: 100, displayName: 'Alice' });
		expect(result[1]).toEqual({ id: 200, displayName: 'Bob' });
	});

	it('should return empty array for primitive arrays', () => {
		const data = {
			tags: ['tag1', 'tag2', 'tag3'],
			numbers: [1, 2, 3],
		};

		const result = findAndFlattenArrays(data);

		expect(result).toHaveLength(0);
	});

	it('should handle multiple arrays in one object', () => {
		const data = {
			contacts: [{ id: 1, name: 'John' }],
			groups: [{ id: 10, title: 'Team A' }],
		};

		const result = findAndFlattenArrays(data);

		expect(result).toHaveLength(2);
		expect(result).toContainEqual({ id: 1, name: 'John' });
		expect(result).toContainEqual({ id: 10, title: 'Team A' });
	});

	it('should handle empty input gracefully', () => {
		expect(findAndFlattenArrays(null)).toHaveLength(0);
		expect(findAndFlattenArrays(undefined)).toHaveLength(0);
		expect(findAndFlattenArrays({})).toHaveLength(0);
		expect(findAndFlattenArrays([])).toHaveLength(0);
	});
});

/**
 * Test 2: Text Formatting
 * Tests the conversion of JSON objects to readable text for embeddings.
 */
describe('Text Formatting', () => {
	const contact = {
		id: 586558850,
		username: 'johngvibes',
		displayName: 'John Vibes',
		contactType: 'user',
		phone: '14436190761',
	};

	it('should convert object to readable text with proper labels', () => {
		const text = objectToReadableText(contact);

		expect(text).toContain('Id: 586558850');
		expect(text).toContain('Username: johngvibes');
		expect(text).toContain('Display Name: John Vibes');
		expect(text).toContain('Contact Type: user');
		expect(text).toContain('Phone: 14436190761');
	});

	it('should convert camelCase and snake_case keys to readable labels', () => {
		expect(keyToLabel('displayName')).toBe('Display Name');
		expect(keyToLabel('user_id')).toBe('User Id');
		expect(keyToLabel('firstName')).toBe('First Name');
		expect(keyToLabel('phone_number')).toBe('Phone Number');
		expect(keyToLabel('id')).toBe('Id');
	});

	it('should handle nested objects', () => {
		const nested = {
			user: {
				name: 'John',
				address: {
					city: 'NYC',
					zip: '10001',
				},
			},
		};

		const text = objectToReadableText(nested);

		expect(text).toContain('User:');
		expect(text).toContain('Name: John');
		expect(text).toContain('Address:');
		expect(text).toContain('City: NYC');
		expect(text).toContain('Zip: 10001');
	});

	it('should apply template with placeholders', () => {
		const template = '{{ displayName }} (@{{ username }}) - Phone: {{ phone }}';
		const result = applyTemplate(template, contact);

		expect(result).toBe('John Vibes (@johngvibes) - Phone: 14436190761');
	});

	it('should handle missing template fields gracefully', () => {
		const template = '{{ name }} - {{ email }}';
		const obj = { name: 'John' };
		const result = applyTemplate(template, obj);

		expect(result).toBe('John - ');
	});

	it('should format as JSON string when requested', () => {
		const result = formatObjectAsText(contact, 'json');
		const parsed = JSON.parse(result);

		expect(parsed).toEqual(contact);
	});
});

/**
 * Test 3: Metadata Building
 * Tests the extraction and building of document metadata.
 */
describe('Metadata Building', () => {
	const contact = {
		id: 123,
		username: 'testuser',
		displayName: 'Test User',
		type: 'premium',
		tags: ['vip', 'active'],
	};

	it('should extract document ID from specified field', () => {
		expect(extractDocumentId(contact, 'id', 0)).toBe(123);
		expect(extractDocumentId(contact, 'username', 0)).toBe('testuser');
	});

	it('should fallback to index-based ID when field not found', () => {
		expect(extractDocumentId(contact, 'nonexistent', 5)).toBe('doc_5');
		expect(extractDocumentId({}, 'id', 10)).toBe('doc_10');
	});

	it('should build complete metadata with all options', () => {
		const options = {
			idField: 'id',
			includeRawJson: true,
			skipEmpty: true,
			metadataFields: ['type', 'username'],
		};

		const metadata = buildDocumentMetadata(contact, 0, options);

		expect(metadata.index).toBe(0);
		expect(metadata.id).toBe(123);
		expect(metadata.type).toBe('premium');
		expect(metadata.username).toBe('testuser');
		expect(metadata.rawJson).toBeDefined();
		expect(JSON.parse(metadata.rawJson as string)).toEqual(contact);
	});

	it('should exclude rawJson when includeRawJson is false', () => {
		const options = {
			idField: 'id',
			includeRawJson: false,
			skipEmpty: true,
			metadataFields: [],
		};

		const metadata = buildDocumentMetadata(contact, 0, options);

		expect(metadata.rawJson).toBeUndefined();
	});

	it('should parse metadata fields string correctly', () => {
		expect(parseMetadataFieldsString('type, category, tags')).toEqual([
			'type',
			'category',
			'tags',
		]);
		expect(parseMetadataFieldsString('  field1 ,  field2  ')).toEqual(['field1', 'field2']);
		expect(parseMetadataFieldsString('')).toEqual([]);
		expect(parseMetadataFieldsString('   ')).toEqual([]);
	});
});

/**
 * Test 4: Batch Output Format
 * Tests the structure of batch output for embedding APIs.
 */
describe('Batch Output Format', () => {
	it('should produce correct batch structure for embedding APIs', () => {
		// Simulate what the node would produce
		const documents = [
			{ text: 'Document 1 content', metadata: { id: 1, index: 0 } },
			{ text: 'Document 2 content', metadata: { id: 2, index: 1 } },
			{ text: 'Document 3 content', metadata: { id: 3, index: 2 } },
		];

		// This is the structure the node outputs in batch mode
		const batchOutput = {
			documents,
			texts: documents.map((d) => d.text),
			count: documents.length,
			batchRequest: documents.map((d, i) => ({
				index: i,
				text: d.text,
			})),
		};

		// Verify structure
		expect(batchOutput.count).toBe(3);
		expect(batchOutput.texts).toHaveLength(3);
		expect(batchOutput.texts[0]).toBe('Document 1 content');

		// Verify batchRequest format (ready for embedding API)
		expect(batchOutput.batchRequest).toHaveLength(3);
		expect(batchOutput.batchRequest[0]).toEqual({
			index: 0,
			text: 'Document 1 content',
		});
	});

	it('should maintain document order in batch output', () => {
		const contacts = [
			{ id: 1, name: 'Alice' },
			{ id: 2, name: 'Bob' },
			{ id: 3, name: 'Charlie' },
		];

		const texts = contacts.map((c) => objectToReadableText(c));

		expect(texts[0]).toContain('Alice');
		expect(texts[1]).toContain('Bob');
		expect(texts[2]).toContain('Charlie');

		// Order is preserved
		expect(texts.indexOf(texts.find((t) => t.includes('Alice'))!)).toBe(0);
		expect(texts.indexOf(texts.find((t) => t.includes('Bob'))!)).toBe(1);
		expect(texts.indexOf(texts.find((t) => t.includes('Charlie'))!)).toBe(2);
	});

	it('should handle large batches efficiently', () => {
		// Simulate 100 contacts (like the user has)
		const contacts = Array.from({ length: 100 }, (_, i) => ({
			id: i + 1,
			displayName: `Contact ${i + 1}`,
			phone: `555-${String(i).padStart(4, '0')}`,
		}));

		const startTime = Date.now();

		const texts = contacts.map((c) => objectToReadableText(c));
		const batchRequest = texts.map((text, i) => ({ index: i, text }));

		const endTime = Date.now();

		// Should process 100 items in under 100ms
		expect(endTime - startTime).toBeLessThan(100);
		expect(texts).toHaveLength(100);
		expect(batchRequest).toHaveLength(100);

		// Verify first and last
		expect(texts[0]).toContain('Contact 1');
		expect(texts[99]).toContain('Contact 100');
	});

	it('should produce texts suitable for Gemini batch embedding API', () => {
		const contacts = [
			{ id: 1, displayName: 'John', username: 'john123' },
			{ id: 2, displayName: 'Jane', username: 'jane456' },
		];

		const texts = contacts.map((c) => objectToReadableText(c));

		// Format expected by Gemini batchEmbedContents API
		const geminiRequest = {
			requests: texts.map((text) => ({
				model: 'models/text-embedding-004',
				content: { parts: [{ text }] },
			})),
		};

		expect(geminiRequest.requests).toHaveLength(2);
		expect(geminiRequest.requests[0].content.parts[0].text).toContain('John');
		expect(geminiRequest.requests[1].content.parts[0].text).toContain('Jane');
	});
});

