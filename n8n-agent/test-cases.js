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
    'knowledge-rag-search': {
      query: 'what do you know about X?',
      entity: 'knowledge-rag'
    },
    'knowledge-rag-insert': {
      query: 'remember that Y is important',
      entity: 'knowledge-rag',
      mode: 'INSERT'
    },
    // Schema validation tests - these should catch parameter mismatches early
    'knowledge-rag-search-no-mode': {
      query: 'test query without mode',
      entity: 'knowledge-rag'
      // mode omitted - should default to SEARCH
    },
    'knowledge-rag-insert-explicit': {
      query: 'Test knowledge entry with explicit INSERT mode',
      entity: 'knowledge-rag',
      mode: 'INSERT'
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
    'knowledge-rag-default-mode': {
      query: 'default mode test',
      entity: 'knowledge-rag'
      // No mode specified - should default to SEARCH
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
  // ────────────────────────────────────────────────────────────────
  'DynamicRAG': {
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
    'create-collection': {
      mode: 'CREATE',
      collectionId: 'test-collection'
    },
    'delete-collection': {
      mode: 'DELETE',
      collectionId: 'test-collection'
    },
    'clear-collection': {
      mode: 'CLEAR',
      collectionId: 'test-collection'
    },
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
    'search-test': {
      mode: 'SEARCH',
      collectionId: 'test-collection',
      input: 'engineer backend'
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
    },
    // Schema validation tests - ensures the agent can call knowledge-rag
    'test-knowledge-rag-call': {
      userPrompt: 'Store this information in your knowledge base: "The project deadline is December 15th, 2025. Key stakeholders are Alice, Bob, and Charlie."'
    },
    'test-knowledge-rag-search': {
      userPrompt: 'What do you know about project deadlines? Search your knowledge base.'
    }
  }

};

module.exports = TESTS;

