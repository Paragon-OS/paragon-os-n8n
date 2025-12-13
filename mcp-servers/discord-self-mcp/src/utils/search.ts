import type { ContactData, ContactSearchResult, MatchResult } from '../types/discord.js'

/**
 * Calculate Levenshtein distance between two strings
 */
export function calculateLevenshteinDistance(a: string, b: string): number {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null))
  
  for (let i = 0; i <= a.length; i++) {
    matrix[0][i] = i
  }
  
  for (let j = 0; j <= b.length; j++) {
    matrix[j][0] = j
  }
  
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,     // deletion
        matrix[j - 1][i] + 1,     // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      )
    }
  }
  
  return matrix[b.length][a.length]
}

/**
 * Score a match between query and target string
 */
export function scoreMatch(query: string, target: string, field: string): MatchResult {
  const queryLower = query.toLowerCase()
  const targetLower = target.toLowerCase()
  
  // Exact match
  if (queryLower === targetLower) {
    return {
      matchType: 'exact',
      score: 100,
      field: field as 'username' | 'displayName' | 'tag'
    }
  }
  
  // Substring match
  if (targetLower.includes(queryLower)) {
    const score = Math.round(60 + (30 * queryLower.length / targetLower.length))
    return {
      matchType: 'substring',
      score: Math.min(score, 90),
      field: field as 'username' | 'displayName' | 'tag'
    }
  }
  
  // Fuzzy match using Levenshtein distance
  const distance = calculateLevenshteinDistance(queryLower, targetLower)
  const maxDistance = Math.max(2, Math.floor(queryLower.length / 3))
  
  if (distance <= maxDistance) {
    const similarity = Math.max(0, (targetLower.length - distance) / targetLower.length)
    const score = Math.round(30 + (20 * similarity))
    return {
      matchType: 'fuzzy',
      score: Math.min(score, 50),
      field: field as 'username' | 'displayName' | 'tag'
    }
  }
  
  // No match
  return {
    matchType: 'fuzzy',
    score: 0,
    field: field as 'username' | 'displayName' | 'tag'
  }
}

/**
 * Search a contact against a query string
 */
export function searchContact(contact: ContactData, query: string): ContactSearchResult | null {
  const matches: MatchResult[] = []
  
  // Test against username
  const usernameMatch = scoreMatch(query, contact.username, 'username')
  if (usernameMatch.score > 0) {
    matches.push(usernameMatch)
  }
  
  // Test against displayName
  const displayNameMatch = scoreMatch(query, contact.displayName, 'displayName')
  if (displayNameMatch.score > 0) {
    matches.push(displayNameMatch)
  }
  
  // Test against tag
  const tagMatch = scoreMatch(query, contact.tag, 'tag')
  if (tagMatch.score > 0) {
    matches.push(tagMatch)
  }
  
  if (matches.length === 0) {
    return null
  }
  
  // Find the best match
  const bestMatch = matches.reduce((best, current) => 
    current.score > best.score ? current : best
  )
  
  // Determine if this is multi-criteria (multiple fields match)
  const matchType = matches.length > 1 ? 'multi-criteria' : bestMatch.matchType
  
  return {
    ...contact,
    matchType,
    matchScore: bestMatch.score,
    matchedField: bestMatch.field
  }
}
