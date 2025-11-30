import { describe, it, expect, beforeEach } from 'vitest';
import { FuzzySearch } from '../FuzzySearch.node';

describe('FuzzySearch - Node Description', () => {
	let fuzzySearchNode: FuzzySearch;

	beforeEach(() => {
		fuzzySearchNode = new FuzzySearch();
	});

	it('should have correct node metadata', () => {
		expect(fuzzySearchNode.description.displayName).toContain('FuzzySearch');
		expect(fuzzySearchNode.description.name).toBe('fuzzySearch');
		expect(fuzzySearchNode.description.version).toBe(1);
		expect(fuzzySearchNode.description.group).toContain('transform');
	});

	it('should have two search modes', () => {
		const searchModeProperty = fuzzySearchNode.description.properties.find(
			(p) => p.name === 'searchMode',
		);
		expect(searchModeProperty).toBeDefined();
		expect(searchModeProperty?.type).toBe('options');
		if (searchModeProperty?.type === 'options') {
			expect(searchModeProperty.options).toHaveLength(2);
		}
	});
});

