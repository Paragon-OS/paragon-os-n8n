// ╔══════════════════════════════════════════════════════════════════╗
// ║                    TEST CASES DATABASE                            ║
// ║  Add your test cases here. They sync with workflow backups.       ║
// ╚══════════════════════════════════════════════════════════════════╝

const TESTS = {
  
  // ────────────────────────────────────────────────────────────────
  // Telegram Context Scout
  // ────────────────────────────────────────────────────────────────
  'TelegramContextScout': {
    'contact-rag': {
      query: 'sebastian',
      entity: 'contact-rag'
    },
    'message-rag': {
      query: 'meeting',
      entity: 'message-rag'
    },
    'chat-with-all-params': {
      query: 'metarune management',
      entity: 'chat'
    },
    // Test all entity types to ensure schema compatibility
    'all-entities-test': {
      query: 'test',
      entity: 'contact'
    },
    'contact-fuzzy': {
      query: 'lanka',
      entity: 'contact'
    },
    'chat-search': {
      query: 'metarune',
      entity: 'chat'
    },
    'tool-lookup': {
      query: 'send message',
      entity: 'tool'
    },
    'self-profile': {
      query: '',
      entity: 'self'
    }
  },

  // ────────────────────────────────────────────────────────────────
  // Dynamic RAG
  // Tests are ordered for proper execution (create → use → delete)
  // ────────────────────────────────────────────────────────────────
  'DynamicRAG': {
    // 1. Status checks on existing collections
    'status': {
      mode: 'STATUS',
      collectionId: 'paragon-os-contacts'
    },
    'search-contacts': {
      mode: 'SEARCH',
      collectionId: 'paragon-os-contacts',
      input: 'lanka'
    },
    'search-metarune': {
      mode: 'SEARCH',
      collectionId: 'paragon-os-knowledge',
      input: 'metarune'
    },
    // 2. Create test collection
    'create-collection': {
      mode: 'CREATE',
      collectionId: 'test-collection'
    },
    // 3. Clear it (ensure empty)
    'clear-collection': {
      mode: 'CLEAR',
      collectionId: 'test-collection'
    },
    // 4. Insert test data
    'insert': {
      mode: 'INSERT',
      collectionId: 'test-collection',
      input: {
        content: {
          testDocuments: [
            { id: 1, name: 'Alice Smith', role: 'Engineer', department: 'Backend' },
            { id: 2, name: 'Bob Johnson', role: 'Designer', department: 'Frontend' },
            { id: 3, name: 'Charlie Brown', role: 'Manager', department: 'Operations' }
          ]
        },
        metadata: { source: 'integration-test' }
      }
    },
    // 5. Search the inserted data
    'search-test': {
      mode: 'SEARCH',
      collectionId: 'test-collection',
      input: 'engineer backend'
    },
    // 6. Delete collection (cleanup - runs last)
    'delete-collection': {
      mode: 'DELETE',
      collectionId: 'test-collection'
    }
  },

  // ────────────────────────────────────────────────────────────────
  // Discord Context Scout
  // ────────────────────────────────────────────────────────────────
  'DiscordContextScout': {
    'contact-fuzzy': {
      query: 'hubert',
      entity: 'contact'
    },
    'guild-search': {
      query: 'test',
      entity: 'guild'
    },
    'tool-lookup': {
      query: 'read',
      entity: 'tool'
    },
    'self-profile': {
      query: '',
      entity: 'self'
    },
    'contact-empty-query': {
      query: '',
      entity: 'contact'
    }
  },

  // ────────────────────────────────────────────────────────────────
  // Discord Smart Agent
  // ────────────────────────────────────────────────────────────────
  'DiscordSmartAgent': {
    'simple-query': {
      userPrompt: 'What is my Discord profile?'
    },
    'list-contacts': {
      userPrompt: 'List my Discord contacts'
    },
    'read-messages': {
      userPrompt: 'Show me recent messages from my Discord DMs'
    }
  },

  // ────────────────────────────────────────────────────────────────
  // Telegram Smart Agent
  // ────────────────────────────────────────────────────────────────
  'TelegramSmartAgent': {
    'search-messages': {
      userPrompt: 'Search for messages about meeting'
    },
    'find-message-content': {
      userPrompt: 'Find messages containing the word "project" in my Telegram chats'
    },
    'list-contacts': {
      userPrompt: 'List my Telegram contacts'
    },
    'simple-query': {
      userPrompt: 'What is my Telegram profile?'
    },
    'ingest-metarune-messages': {
      userPrompt: 'List the last 10 messages from the metarune management chat, then properly ingest them into the RAG knowledge base for future retrieval. Format the messages clearly with sender names and timestamps before storing them.'
    }
  }

};

module.exports = TESTS;

