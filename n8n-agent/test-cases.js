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
      collectionId: 'paragon-os-knowledge-dev',
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
  // Discord Context Scout (template - add your tests)
  // ────────────────────────────────────────────────────────────────
  'DiscordContextScout': {
    'example': {
      query: 'example query',
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
    }
  }

};

module.exports = TESTS;

