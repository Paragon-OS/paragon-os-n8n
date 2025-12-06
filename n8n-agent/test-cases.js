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
      collectionId: 'chat-agent-experiment-1',
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
  }

};

module.exports = TESTS;

