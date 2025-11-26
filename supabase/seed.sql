-- ============================================================================
-- Seed Data for ParagonOS Chat Application
-- ============================================================================
-- This file provides comprehensive seed data for development and testing
-- Tables: chat_sessions, chat_messages, stream_events
-- Schema: Refactored schema (20251126000000_refactor_chat_schema)
-- ============================================================================

-- Clear existing data (in correct order to respect foreign keys)
TRUNCATE TABLE stream_events CASCADE;
TRUNCATE TABLE chat_messages CASCADE;
TRUNCATE TABLE chat_sessions CASCADE;

-- ============================================================================
-- CHAT SESSIONS
-- ============================================================================
-- Create diverse chat sessions with different scenarios

INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at) VALUES
-- Session 1: Getting Started with ParagonOS
('550e8400-e29b-41d4-a716-446655440001', 'user_alice', 'Getting Started with ParagonOS', 
 '2025-11-20 10:00:00+00', '2025-11-20 10:15:30+00'),

-- Session 2: Workflow Automation Discussion
('550e8400-e29b-41d4-a716-446655440002', 'user_bob', 'Workflow Automation Setup', 
 '2025-11-21 14:30:00+00', '2025-11-21 15:45:20+00'),

-- Session 3: Debugging n8n Integration
('550e8400-e29b-41d4-a716-446655440003', 'user_alice', 'Debugging n8n Webhook Issues', 
 '2025-11-22 09:15:00+00', '2025-11-22 10:30:45+00'),

-- Session 4: Discord Bot Configuration
('550e8400-e29b-41d4-a716-446655440004', 'user_charlie', 'Discord MCP Client Setup', 
 '2025-11-23 16:00:00+00', '2025-11-23 16:45:00+00'),

-- Session 5: General Questions
('550e8400-e29b-41d4-a716-446655440005', 'user_bob', 'Quick Questions', 
 '2025-11-24 11:00:00+00', '2025-11-24 11:10:00+00'),

-- Session 6: Advanced Tool Usage
('550e8400-e29b-41d4-a716-446655440006', 'user_alice', 'Advanced Tool Integration', 
 '2025-11-25 13:00:00+00', '2025-11-25 14:30:00+00'),

-- Session 7: Recent Empty Session
('550e8400-e29b-41d4-a716-446655440007', 'user_charlie', 'New Chat', 
 '2025-11-26 08:00:00+00', '2025-11-26 08:00:00+00');

-- ============================================================================
-- CHAT MESSAGES
-- ============================================================================
-- Create realistic conversation messages following the refactored schema
-- Content is stored as JSONB array of content parts
-- Tools are stored as JSONB with calls and invocations

-- ----------------------------------------------------------------------------
-- Session 1: Getting Started with ParagonOS
-- ----------------------------------------------------------------------------

INSERT INTO chat_messages (id, session_id, role, content, tools, execution_id, created_at) VALUES
-- User's initial question
('650e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440001', 'user', 
 '[{"type": "text", "text": "What is ParagonOS and how does it work?"}]'::jsonb,
 NULL, NULL, '2025-11-20 10:00:00+00'),

-- Assistant's response
('650e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440001', 'assistant', 
 '[{"type": "text", "text": "ParagonOS is an AI-powered workflow orchestration platform that integrates with n8n to provide intelligent automation capabilities. It features:\n\n1. **Chat Interface**: Natural language interaction with AI assistants\n2. **n8n Integration**: Direct connection to n8n workflows for automation\n3. **Stream Monitoring**: Real-time visibility into workflow execution\n4. **Multi-Channel Support**: Discord, Telegram, and web interfaces\n\nThe system uses a modern tech stack with Next.js, Supabase for persistence, and the AI SDK for chat functionality. Would you like to know more about any specific feature?"}]'::jsonb,
 NULL, NULL, '2025-11-20 10:00:15+00'),

-- User follow-up
('650e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440001', 'user', 
 '[{"type": "text", "text": "How do I set up my first workflow?"}]'::jsonb,
 NULL, NULL, '2025-11-20 10:05:00+00'),

-- Assistant with tool usage
('650e8400-e29b-41d4-a716-446655440004', '550e8400-e29b-41d4-a716-446655440001', 'assistant', 
 '[{"type": "text", "text": "Let me help you set up your first workflow. I''ll check the available workflows in your n8n instance."}]'::jsonb,
 '{"calls": [{"toolCallId": "call_001", "toolName": "list_workflows", "args": {}}], "invocations": [{"type": "tool-invocation", "toolCallId": "call_001", "toolName": "list_workflows", "state": "result", "result": {"workflows": ["ParagonOS Manager", "Discord MCP Client Sequencer", "Telegram MCP Client Sequencer"]}}]}'::jsonb,
 'exec_001', '2025-11-20 10:05:10+00'),

-- Assistant continues
('650e8400-e29b-41d4-a716-446655440005', '550e8400-e29b-41d4-a716-446655440001', 'assistant', 
 '[{"type": "text", "text": "Great! You have several workflows available:\n\n1. **ParagonOS Manager** - Core orchestration workflow\n2. **Discord MCP Client Sequencer** - Discord bot integration\n3. **Telegram MCP Client Sequencer** - Telegram bot integration\n\nTo set up your first workflow:\n\n1. Open n8n and select a workflow template\n2. Configure the webhook URL in your ParagonOS settings\n3. Test the connection using the webhook mode toggle\n4. Start sending messages!\n\nWould you like me to help you configure a specific workflow?"}]'::jsonb,
 NULL, NULL, '2025-11-20 10:05:20+00'),

-- User confirmation
('650e8400-e29b-41d4-a716-446655440006', '550e8400-e29b-41d4-a716-446655440001', 'user', 
 '[{"type": "text", "text": "Thanks! I''ll start with the ParagonOS Manager workflow."}]'::jsonb,
 NULL, NULL, '2025-11-20 10:15:00+00'),

-- Assistant closing
('650e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440001', 'assistant', 
 '[{"type": "text", "text": "Excellent choice! The ParagonOS Manager is the central workflow that coordinates all operations. Feel free to ask if you need any help during setup. Good luck! 🚀"}]'::jsonb,
 NULL, NULL, '2025-11-20 10:15:30+00');

-- ----------------------------------------------------------------------------
-- Session 2: Workflow Automation Discussion
-- ----------------------------------------------------------------------------

INSERT INTO chat_messages (id, session_id, role, content, tools, execution_id, created_at) VALUES
-- User question about automation
('650e8400-e29b-41d4-a716-446655440008', '550e8400-e29b-41d4-a716-446655440002', 'user', 
 '[{"type": "text", "text": "I want to automate my daily standup reports. Can you help?"}]'::jsonb,
 NULL, NULL, '2025-11-21 14:30:00+00'),

-- Assistant response
('650e8400-e29b-41d4-a716-446655440009', '550e8400-e29b-41d4-a716-446655440002', 'assistant', 
 '[{"type": "text", "text": "Absolutely! Automating daily standup reports is a great use case. Here''s what we can do:\n\n**Workflow Design:**\n1. Schedule trigger (daily at your preferred time)\n2. Collect data from your project management tools\n3. Generate a formatted report\n4. Send to Slack/Discord/Email\n\n**Required Information:**\n- What time do you want the report?\n- Which tools do you use? (Jira, GitHub, Linear, etc.)\n- Where should the report be sent?\n- What information should be included?\n\nLet me know these details and I''ll help you create the workflow!"}]'::jsonb,
 NULL, NULL, '2025-11-21 14:30:30+00'),

-- User provides details
('650e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440002', 'user', 
 '[{"type": "text", "text": "I use GitHub for issues and PRs. I''d like the report at 9 AM daily, sent to our Discord channel. Include: open issues, PRs pending review, and commits from yesterday."}]'::jsonb,
 NULL, NULL, '2025-11-21 14:35:00+00'),

-- Assistant with tool call
('650e8400-e29b-41d4-a716-446655440011', '550e8400-e29b-41d4-a716-446655440002', 'assistant', 
 '[{"type": "text", "text": "Perfect! Let me create a workflow configuration for you."}]'::jsonb,
 '{"calls": [{"toolCallId": "call_002", "toolName": "create_workflow", "args": {"name": "Daily Standup Report", "schedule": "0 9 * * *", "integrations": ["github", "discord"]}}], "invocations": [{"type": "tool-invocation", "toolCallId": "call_002", "toolName": "create_workflow", "state": "result", "result": {"workflowId": "wf_standup_001", "status": "created", "webhookUrl": "https://n8n.example.com/webhook/standup"}}]}'::jsonb,
 'exec_002', '2025-11-21 14:35:30+00'),

-- Assistant continues with details
('650e8400-e29b-41d4-a716-446655440012', '550e8400-e29b-41d4-a716-446655440002', 'assistant', 
 '[{"type": "text", "text": "Great! I''ve created your workflow. Here''s what it will do:\n\n**Daily Standup Report Workflow**\n- **Schedule**: Every day at 9:00 AM\n- **Data Sources**: GitHub (issues, PRs, commits)\n- **Destination**: Discord channel\n\n**Next Steps:**\n1. Configure your GitHub API token in n8n\n2. Set up Discord webhook URL\n3. Test the workflow manually\n4. Enable the schedule\n\nThe workflow is ready at: `https://n8n.example.com/webhook/standup`\n\nWould you like help with the configuration?"}]'::jsonb,
 NULL, NULL, '2025-11-21 14:36:00+00'),

-- User satisfied
('650e8400-e29b-41d4-a716-446655440013', '550e8400-e29b-41d4-a716-446655440002', 'user', 
 '[{"type": "text", "text": "This is perfect! I''ll configure the tokens and test it. Thank you!"}]'::jsonb,
 NULL, NULL, '2025-11-21 15:45:00+00'),

-- Assistant closing
('650e8400-e29b-41d4-a716-446655440014', '550e8400-e29b-41d4-a716-446655440002', 'assistant', 
 '[{"type": "text", "text": "You''re welcome! Don''t hesitate to reach out if you need any adjustments or run into issues. Happy automating! 🤖"}]'::jsonb,
 NULL, NULL, '2025-11-21 15:45:20+00');

-- ----------------------------------------------------------------------------
-- Session 3: Debugging n8n Integration
-- ----------------------------------------------------------------------------

INSERT INTO chat_messages (id, session_id, role, content, tools, execution_id, created_at) VALUES
-- User reports issue
('650e8400-e29b-41d4-a716-446655440015', '550e8400-e29b-41d4-a716-446655440003', 'user', 
 '[{"type": "text", "text": "My webhook isn''t responding. I''m getting timeout errors when I try to trigger workflows."}]'::jsonb,
 NULL, NULL, '2025-11-22 09:15:00+00'),

-- Assistant debugging
('650e8400-e29b-41d4-a716-446655440016', '550e8400-e29b-41d4-a716-446655440003', 'assistant', 
 '[{"type": "text", "text": "Let me help you debug this. Timeout errors usually indicate:\n\n1. Network connectivity issues\n2. n8n instance not running\n3. Incorrect webhook URL\n4. Workflow not activated\n\nLet me check the health of your n8n instance."}]'::jsonb,
 '{"calls": [{"toolCallId": "call_003", "toolName": "check_n8n_health", "args": {}}], "invocations": [{"type": "tool-invocation", "toolCallId": "call_003", "toolName": "check_n8n_health", "state": "result", "result": {"status": "healthy", "version": "1.19.4", "activeWorkflows": 3}}]}'::jsonb,
 'exec_003', '2025-11-22 09:15:30+00'),

-- Assistant continues
('650e8400-e29b-41d4-a716-446655440017', '550e8400-e29b-41d4-a716-446655440003', 'assistant', 
 '[{"type": "text", "text": "Good news - your n8n instance is healthy and running. Let''s check a few things:\n\n**Troubleshooting Steps:**\n1. Verify your webhook URL format: `https://your-n8n.com/webhook/workflow-name`\n2. Check if the workflow is activated (toggle should be ON)\n3. Look at the n8n execution logs for error details\n4. Test with a simple GET request first\n\nCan you share:\n- The webhook URL you''re using?\n- The workflow name?\n- Any error messages from the browser console?"}]'::jsonb,
 NULL, NULL, '2025-11-22 09:16:00+00'),

-- User provides info
('650e8400-e29b-41d4-a716-446655440018', '550e8400-e29b-41d4-a716-446655440003', 'user', 
 '[{"type": "text", "text": "The URL is https://n8n.mycompany.com/webhook/paragon-manager and the workflow is active. Console shows: ''Failed to fetch - net::ERR_CONNECTION_TIMED_OUT''"}]'::jsonb,
 NULL, NULL, '2025-11-22 09:20:00+00'),

-- Assistant identifies issue
('650e8400-e29b-41d4-a716-446655440019', '550e8400-e29b-41d4-a716-446655440003', 'assistant', 
 '[{"type": "text", "text": "Ah, I see the issue! The error `ERR_CONNECTION_TIMED_OUT` suggests a network/firewall problem. Here are the likely causes:\n\n**Common Issues:**\n1. **CORS Configuration**: n8n needs CORS headers for browser requests\n2. **Firewall Rules**: Your n8n instance might not be accessible from your network\n3. **SSL/TLS Issues**: Certificate problems can cause timeouts\n\n**Solutions:**\n1. Add CORS headers in n8n settings:\n   ```\n   N8N_CORS_ORIGIN=https://your-paragon-app.com\n   ```\n2. Check firewall rules allow incoming connections\n3. Try accessing the webhook URL directly in a browser\n4. Use webhook mode toggle to switch to production/test endpoints\n\nWould you like me to help you configure CORS or check the firewall?"}]'::jsonb,
 NULL, NULL, '2025-11-22 09:21:00+00'),

-- User resolves
('650e8400-e29b-41d4-a716-446655440020', '550e8400-e29b-41d4-a716-446655440003', 'user', 
 '[{"type": "text", "text": "Found it! The CORS origin wasn''t set. Added it and now it works perfectly. Thanks!"}]'::jsonb,
 NULL, NULL, '2025-11-22 10:30:00+00'),

-- Assistant closing
('650e8400-e29b-41d4-a716-446655440021', '550e8400-e29b-41d4-a716-446655440003', 'assistant', 
 '[{"type": "text", "text": "Excellent! CORS issues are very common with webhook integrations. Glad we got it sorted out. Your workflows should now run smoothly! 🎉"}]'::jsonb,
 NULL, NULL, '2025-11-22 10:30:45+00');

-- ----------------------------------------------------------------------------
-- Session 4: Discord Bot Configuration
-- ----------------------------------------------------------------------------

INSERT INTO chat_messages (id, session_id, role, content, tools, execution_id, created_at) VALUES
-- User wants Discord bot
('650e8400-e29b-41d4-a716-446655440022', '550e8400-e29b-41d4-a716-446655440004', 'user', 
 '[{"type": "text", "text": "How do I set up the Discord MCP Client? I want my bot to respond to commands in my server."}]'::jsonb,
 NULL, NULL, '2025-11-23 16:00:00+00'),

-- Assistant explains
('650e8400-e29b-41d4-a716-446655440023', '550e8400-e29b-41d4-a716-446655440004', 'assistant', 
 '[{"type": "text", "text": "Great! The Discord MCP Client Sequencer allows you to create intelligent Discord bots. Here''s the setup process:\n\n**Prerequisites:**\n1. Discord Bot Token (from Discord Developer Portal)\n2. Discord Server ID where bot will operate\n3. n8n workflow configured\n\n**Setup Steps:**\n1. Create a Discord application at https://discord.com/developers\n2. Generate a bot token\n3. Invite bot to your server with proper permissions\n4. Configure the Discord MCP Client workflow in n8n\n5. Set environment variables:\n   - `DISCORD_BOT_TOKEN`\n   - `DISCORD_GUILD_ID`\n\n**Bot Capabilities:**\n- Respond to mentions\n- Execute commands\n- Stream responses in real-time\n- Access MCP tools\n\nDo you already have a Discord bot created?"}]'::jsonb,
 NULL, NULL, '2025-11-23 16:01:00+00'),

-- User has bot
('650e8400-e29b-41d4-a716-446655440024', '550e8400-e29b-41d4-a716-446655440004', 'user', 
 '[{"type": "text", "text": "Yes, I have the bot token and it''s already in my server. What''s next?"}]'::jsonb,
 NULL, NULL, '2025-11-23 16:05:00+00'),

-- Assistant provides config
('650e8400-e29b-41d4-a716-446655440025', '550e8400-e29b-41d4-a716-446655440004', 'assistant', 
 '[{"type": "text", "text": "Perfect! Now let''s configure the workflow:\n\n**Configuration:**\n1. Open the ''Discord MCP Client Sequencer'' workflow in n8n\n2. Update the Discord credentials node with your bot token\n3. Set the guild ID in the configuration\n4. Activate the workflow\n\n**Testing:**\n1. Mention your bot in Discord: `@YourBot hello`\n2. Bot should respond within a few seconds\n3. Check the Stream Monitor tab to see execution details\n\n**Common Commands:**\n- `@YourBot help` - Show available commands\n- `@YourBot status` - Check bot status\n- `@YourBot execute [workflow]` - Run a specific workflow\n\nTry mentioning your bot and let me know if it responds!"}]'::jsonb,
 NULL, NULL, '2025-11-23 16:06:00+00'),

-- User tests
('650e8400-e29b-41d4-a716-446655440026', '550e8400-e29b-41d4-a716-446655440004', 'user', 
 '[{"type": "text", "text": "It works! The bot is responding. This is amazing!"}]'::jsonb,
 NULL, NULL, '2025-11-23 16:45:00+00'),

-- Assistant celebrates
('650e8400-e29b-41d4-a716-446655440027', '550e8400-e29b-41d4-a716-446655440004', 'assistant', 
 '[{"type": "text", "text": "Awesome! Your Discord bot is now live! 🎊\n\nYou can now:\n- Interact with your bot naturally\n- Execute workflows from Discord\n- Monitor all activities in the Stream Monitor\n\nEnjoy your new AI-powered Discord assistant!"}]'::jsonb,
 NULL, NULL, '2025-11-23 16:45:00+00');

-- ----------------------------------------------------------------------------
-- Session 5: Quick Questions
-- ----------------------------------------------------------------------------

INSERT INTO chat_messages (id, session_id, role, content, tools, execution_id, created_at) VALUES
-- Quick question
('650e8400-e29b-41d4-a716-446655440028', '550e8400-e29b-41d4-a716-446655440005', 'user', 
 '[{"type": "text", "text": "What''s the difference between webhook mode and production mode?"}]'::jsonb,
 NULL, NULL, '2025-11-24 11:00:00+00'),

-- Quick answer
('650e8400-e29b-41d4-a716-446655440029', '550e8400-e29b-41d4-a716-446655440005', 'assistant', 
 '[{"type": "text", "text": "Great question! Here''s the difference:\n\n**Webhook Mode (Test Mode):**\n- Uses n8n test webhooks\n- Workflows must be open in n8n editor\n- Useful for development and debugging\n- URL format: `/webhook-test/workflow-name`\n\n**Production Mode:**\n- Uses production webhooks\n- Workflows run in background (editor can be closed)\n- For live/production use\n- URL format: `/webhook/workflow-name`\n\n**When to Use:**\n- Development: Webhook Mode ✅\n- Testing: Webhook Mode ✅\n- Production: Production Mode ✅\n\nYou can toggle between modes using the switch in the header!"}]'::jsonb,
 NULL, NULL, '2025-11-24 11:10:00+00');

-- ----------------------------------------------------------------------------
-- Session 6: Advanced Tool Usage with Multiple Tools
-- ----------------------------------------------------------------------------

INSERT INTO chat_messages (id, session_id, role, content, tools, execution_id, created_at) VALUES
-- User asks about data
('650e8400-e29b-41d4-a716-446655440030', '550e8400-e29b-41d4-a716-446655440006', 'user', 
 '[{"type": "text", "text": "Can you analyze my workflow executions from the past week and give me insights?"}]'::jsonb,
 NULL, NULL, '2025-11-25 13:00:00+00'),

-- Assistant uses multiple tools
('650e8400-e29b-41d4-a716-446655440031', '550e8400-e29b-41d4-a716-446655440006', 'assistant', 
 '[{"type": "text", "text": "I''ll analyze your workflow executions for you. Let me gather the data."}]'::jsonb,
 '{"calls": [{"toolCallId": "call_004", "toolName": "get_executions", "args": {"days": 7}}, {"toolCallId": "call_005", "toolName": "analyze_performance", "args": {"executionIds": ["exec_101", "exec_102", "exec_103"]}}], "invocations": [{"type": "tool-invocation", "toolCallId": "call_004", "toolName": "get_executions", "state": "result", "result": {"total": 45, "successful": 42, "failed": 3, "avgDuration": "2.3s"}}, {"type": "tool-invocation", "toolCallId": "call_005", "toolName": "analyze_performance", "state": "result", "result": {"bottlenecks": ["API rate limits", "Database queries"], "recommendations": ["Add caching", "Optimize queries"]}}]}'::jsonb,
 'exec_004', '2025-11-25 13:01:00+00'),

-- Assistant provides insights
('650e8400-e29b-41d4-a716-446655440032', '550e8400-e29b-41d4-a716-446655440006', 'assistant', 
 '[{"type": "text", "text": "Here''s your workflow analysis for the past week:\n\n**Execution Summary:**\n- Total Executions: 45\n- Successful: 42 (93.3%)\n- Failed: 3 (6.7%)\n- Average Duration: 2.3 seconds\n\n**Performance Insights:**\n- Most executions complete quickly\n- 3 failures due to API rate limits\n- Database queries are a bottleneck in some workflows\n\n**Recommendations:**\n1. **Add Caching**: Reduce API calls by caching responses\n2. **Optimize Queries**: Review database query patterns\n3. **Rate Limiting**: Implement retry logic for API calls\n4. **Monitoring**: Set up alerts for failed executions\n\n**Top Performing Workflows:**\n1. Discord MCP Client - 98% success rate\n2. ParagonOS Manager - 95% success rate\n3. Telegram MCP Client - 90% success rate\n\nWould you like me to help implement any of these recommendations?"}]'::jsonb,
 NULL, NULL, '2025-11-25 13:02:00+00'),

-- User interested
('650e8400-e29b-41d4-a716-446655440033', '550e8400-e29b-41d4-a716-446655440006', 'user', 
 '[{"type": "text", "text": "Yes! Let''s add caching to reduce API calls. How do we do that?"}]'::jsonb,
 NULL, NULL, '2025-11-25 13:05:00+00'),

-- Assistant explains caching
('650e8400-e29b-41d4-a716-446655440034', '550e8400-e29b-41d4-a716-446655440006', 'assistant', 
 '[{"type": "text", "text": "Great choice! Here''s how to implement caching in n8n:\n\n**Caching Strategy:**\n\n1. **Redis Cache Node**\n   - Add Redis node to your workflow\n   - Check cache before API call\n   - Store results with TTL (Time To Live)\n\n2. **Workflow Pattern:**\n   ```\n   Start → Check Cache → [Cache Hit? Yes → Return Cached Data]\n                       → [Cache Hit? No → API Call → Store in Cache → Return Data]\n   ```\n\n3. **Configuration:**\n   - Cache key: Use request parameters as key\n   - TTL: Set based on data freshness needs (e.g., 5 minutes)\n   - Invalidation: Clear cache on updates\n\n**Example Setup:**\n- Frequently accessed data: 5-15 minute cache\n- Rarely changing data: 1 hour cache\n- User-specific data: 1 minute cache\n\n**Benefits:**\n- Reduce API costs\n- Faster response times\n- Better rate limit handling\n\nWould you like me to create a cached workflow template for you?"}]'::jsonb,
 NULL, NULL, '2025-11-25 13:06:00+00'),

-- User confirms
('650e8400-e29b-41d4-a716-446655440035', '550e8400-e29b-41d4-a716-446655440006', 'user', 
 '[{"type": "text", "text": "Yes please! Create a template for caching GitHub API responses."}]'::jsonb,
 NULL, NULL, '2025-11-25 14:00:00+00'),

-- Assistant creates template
('650e8400-e29b-41d4-a716-446655440036', '550e8400-e29b-41d4-a716-446655440006', 'assistant', 
 '[{"type": "text", "text": "Let me create that workflow template for you."}]'::jsonb,
 '{"calls": [{"toolCallId": "call_006", "toolName": "create_workflow_template", "args": {"name": "GitHub API with Redis Cache", "nodes": ["Redis", "GitHub", "If", "Merge"]}}], "invocations": [{"type": "tool-invocation", "toolCallId": "call_006", "toolName": "create_workflow_template", "state": "result", "result": {"templateId": "tpl_cache_001", "status": "created", "url": "https://n8n.example.com/workflow/new?template=tpl_cache_001"}}]}'::jsonb,
 'exec_005', '2025-11-25 14:01:00+00'),

-- Assistant provides template
('650e8400-e29b-41d4-a716-446655440037', '550e8400-e29b-41d4-a716-446655440006', 'assistant', 
 '[{"type": "text", "text": "Perfect! I''ve created your workflow template:\n\n**GitHub API with Redis Cache**\n\n**Workflow Structure:**\n1. **Webhook Trigger** - Receives requests\n2. **Redis Get** - Check for cached data\n3. **IF Node** - Cache hit or miss?\n4. **GitHub API** - Fetch fresh data (if cache miss)\n5. **Redis Set** - Store result (TTL: 5 minutes)\n6. **Merge** - Return data\n\n**Access Template:**\n`https://n8n.example.com/workflow/new?template=tpl_cache_001`\n\n**Configuration Needed:**\n- Redis connection (host, port, password)\n- GitHub API token\n- Cache TTL (currently 5 minutes)\n\n**Expected Performance:**\n- First request: ~500ms (API call)\n- Cached requests: ~50ms (10x faster!)\n- API calls reduced by ~80%\n\nImport this template and configure your credentials. Let me know if you need help with the setup!"}]'::jsonb,
 NULL, NULL, '2025-11-25 14:02:00+00'),

-- User satisfied
('650e8400-e29b-41d4-a716-446655440038', '550e8400-e29b-41d4-a716-446655440006', 'user', 
 '[{"type": "text", "text": "This is exactly what I needed! Thank you so much!"}]'::jsonb,
 NULL, NULL, '2025-11-25 14:30:00+00'),

-- Assistant closing
('650e8400-e29b-41d4-a716-446655440039', '550e8400-e29b-41d4-a716-446655440006', 'assistant', 
 '[{"type": "text", "text": "You''re very welcome! Enjoy the performance boost! If you see good results, consider applying caching to your other workflows too. Happy optimizing! ⚡"}]'::jsonb,
 NULL, NULL, '2025-11-25 14:30:00+00');

-- ============================================================================
-- STREAM EVENTS
-- ============================================================================
-- Create stream events for workflow executions
-- These events show the real-time progress of n8n workflow executions

-- Stream events for exec_001 (list_workflows call)
INSERT INTO stream_events (id, execution_id, message_id, stage, status, message, timestamp, data, created_at) VALUES
('750e8400-e29b-41d4-a716-446655440001', 'exec_001', '650e8400-e29b-41d4-a716-446655440004', 
 'initialization', 'in_progress', 'Starting workflow execution', 
 '2025-11-20 10:05:10+00', '{"workflowId": "ParagonOS Manager", "triggerType": "webhook"}'::jsonb, 
 '2025-11-20 10:05:10+00'),

('750e8400-e29b-41d4-a716-446655440002', 'exec_001', '650e8400-e29b-41d4-a716-446655440004', 
 'processing', 'in_progress', 'Fetching workflow list from n8n', 
 '2025-11-20 10:05:11+00', '{"nodeType": "n8n-api", "operation": "list"}'::jsonb, 
 '2025-11-20 10:05:11+00'),

('750e8400-e29b-41d4-a716-446655440003', 'exec_001', '650e8400-e29b-41d4-a716-446655440004', 
 'processing', 'info', 'Found 3 active workflows', 
 '2025-11-20 10:05:12+00', '{"count": 3, "workflows": ["ParagonOS Manager", "Discord MCP Client Sequencer", "Telegram MCP Client Sequencer"]}'::jsonb, 
 '2025-11-20 10:05:12+00'),

('750e8400-e29b-41d4-a716-446655440004', 'exec_001', '650e8400-e29b-41d4-a716-446655440004', 
 'completion', 'completed', 'Workflow execution completed successfully', 
 '2025-11-20 10:05:13+00', '{"duration": "3s", "status": "success"}'::jsonb, 
 '2025-11-20 10:05:13+00');

-- Stream events for exec_002 (create_workflow call)
INSERT INTO stream_events (id, execution_id, message_id, stage, status, message, timestamp, data, created_at) VALUES
('750e8400-e29b-41d4-a716-446655440005', 'exec_002', '650e8400-e29b-41d4-a716-446655440011', 
 'initialization', 'in_progress', 'Creating new workflow', 
 '2025-11-21 14:35:30+00', '{"workflowName": "Daily Standup Report"}'::jsonb, 
 '2025-11-21 14:35:30+00'),

('750e8400-e29b-41d4-a716-446655440006', 'exec_002', '650e8400-e29b-41d4-a716-446655440011', 
 'processing', 'in_progress', 'Generating workflow structure', 
 '2025-11-21 14:35:31+00', '{"nodes": ["Schedule Trigger", "GitHub", "Discord", "Format"]}'::jsonb, 
 '2025-11-21 14:35:31+00'),

('750e8400-e29b-41d4-a716-446655440007', 'exec_002', '650e8400-e29b-41d4-a716-446655440011', 
 'processing', 'in_progress', 'Configuring GitHub integration', 
 '2025-11-21 14:35:33+00', '{"integration": "github", "operations": ["list_issues", "list_prs", "list_commits"]}'::jsonb, 
 '2025-11-21 14:35:33+00'),

('750e8400-e29b-41d4-a716-446655440008', 'exec_002', '650e8400-e29b-41d4-a716-446655440011', 
 'processing', 'in_progress', 'Configuring Discord webhook', 
 '2025-11-21 14:35:35+00', '{"integration": "discord", "operation": "send_message"}'::jsonb, 
 '2025-11-21 14:35:35+00'),

('750e8400-e29b-41d4-a716-446655440009', 'exec_002', '650e8400-e29b-41d4-a716-446655440011', 
 'processing', 'info', 'Setting up schedule trigger', 
 '2025-11-21 14:35:37+00', '{"schedule": "0 9 * * *", "timezone": "UTC"}'::jsonb, 
 '2025-11-21 14:35:37+00'),

('750e8400-e29b-41d4-a716-446655440010', 'exec_002', '650e8400-e29b-41d4-a716-446655440011', 
 'completion', 'completed', 'Workflow created successfully', 
 '2025-11-21 14:35:40+00', '{"workflowId": "wf_standup_001", "webhookUrl": "https://n8n.example.com/webhook/standup", "duration": "10s"}'::jsonb, 
 '2025-11-21 14:35:40+00');

-- Stream events for exec_003 (health check)
INSERT INTO stream_events (id, execution_id, message_id, stage, status, message, timestamp, data, created_at) VALUES
('750e8400-e29b-41d4-a716-446655440011', 'exec_003', '650e8400-e29b-41d4-a716-446655440016', 
 'initialization', 'in_progress', 'Checking n8n instance health', 
 '2025-11-22 09:15:30+00', '{"endpoint": "https://n8n.mycompany.com/healthz"}'::jsonb, 
 '2025-11-22 09:15:30+00'),

('750e8400-e29b-41d4-a716-446655440012', 'exec_003', '650e8400-e29b-41d4-a716-446655440016', 
 'processing', 'in_progress', 'Pinging n8n API', 
 '2025-11-22 09:15:31+00', '{"method": "GET", "timeout": "5s"}'::jsonb, 
 '2025-11-22 09:15:31+00'),

('750e8400-e29b-41d4-a716-446655440013', 'exec_003', '650e8400-e29b-41d4-a716-446655440016', 
 'processing', 'info', 'n8n instance is healthy', 
 '2025-11-22 09:15:32+00', '{"status": "healthy", "version": "1.19.4", "uptime": "15d 7h 23m"}'::jsonb, 
 '2025-11-22 09:15:32+00'),

('750e8400-e29b-41d4-a716-446655440014', 'exec_003', '650e8400-e29b-41d4-a716-446655440016', 
 'processing', 'info', 'Checking active workflows', 
 '2025-11-22 09:15:33+00', '{"activeWorkflows": 3, "totalWorkflows": 8}'::jsonb, 
 '2025-11-22 09:15:33+00'),

('750e8400-e29b-41d4-a716-446655440015', 'exec_003', '650e8400-e29b-41d4-a716-446655440016', 
 'completion', 'completed', 'Health check completed', 
 '2025-11-22 09:15:34+00', '{"duration": "4s", "status": "success"}'::jsonb, 
 '2025-11-22 09:15:34+00');

-- Stream events for exec_004 (get_executions and analyze_performance)
INSERT INTO stream_events (id, execution_id, message_id, stage, status, message, timestamp, data, created_at) VALUES
('750e8400-e29b-41d4-a716-446655440016', 'exec_004', '650e8400-e29b-41d4-a716-446655440031', 
 'initialization', 'in_progress', 'Fetching execution history', 
 '2025-11-25 13:01:00+00', '{"timeRange": "7 days", "limit": 100}'::jsonb, 
 '2025-11-25 13:01:00+00'),

('750e8400-e29b-41d4-a716-446655440017', 'exec_004', '650e8400-e29b-41d4-a716-446655440031', 
 'processing', 'in_progress', 'Querying execution database', 
 '2025-11-25 13:01:02+00', '{"query": "SELECT * FROM executions WHERE created_at > NOW() - INTERVAL ''7 days''"}'::jsonb, 
 '2025-11-25 13:01:02+00'),

('750e8400-e29b-41d4-a716-446655440018', 'exec_004', '650e8400-e29b-41d4-a716-446655440031', 
 'processing', 'info', 'Found 45 executions', 
 '2025-11-25 13:01:04+00', '{"total": 45, "successful": 42, "failed": 3}'::jsonb, 
 '2025-11-25 13:01:04+00'),

('750e8400-e29b-41d4-a716-446655440019', 'exec_004', '650e8400-e29b-41d4-a716-446655440031', 
 'processing', 'in_progress', 'Analyzing performance metrics', 
 '2025-11-25 13:01:06+00', '{"metrics": ["duration", "success_rate", "error_types"]}'::jsonb, 
 '2025-11-25 13:01:06+00'),

('750e8400-e29b-41d4-a716-446655440020', 'exec_004', '650e8400-e29b-41d4-a716-446655440031', 
 'processing', 'info', 'Identifying bottlenecks', 
 '2025-11-25 13:01:08+00', '{"bottlenecks": ["API rate limits", "Database queries"], "avgDuration": "2.3s"}'::jsonb, 
 '2025-11-25 13:01:08+00'),

('750e8400-e29b-41d4-a716-446655440021', 'exec_004', '650e8400-e29b-41d4-a716-446655440031', 
 'processing', 'info', 'Generating recommendations', 
 '2025-11-25 13:01:10+00', '{"recommendations": ["Add caching", "Optimize queries", "Implement retry logic"]}'::jsonb, 
 '2025-11-25 13:01:10+00'),

('750e8400-e29b-41d4-a716-446655440022', 'exec_004', '650e8400-e29b-41d4-a716-446655440031', 
 'completion', 'completed', 'Analysis completed successfully', 
 '2025-11-25 13:01:12+00', '{"duration": "12s", "status": "success"}'::jsonb, 
 '2025-11-25 13:01:12+00');

-- Stream events for exec_005 (create_workflow_template)
INSERT INTO stream_events (id, execution_id, message_id, stage, status, message, timestamp, data, created_at) VALUES
('750e8400-e29b-41d4-a716-446655440023', 'exec_005', '650e8400-e29b-41d4-a716-446655440036', 
 'initialization', 'in_progress', 'Creating workflow template', 
 '2025-11-25 14:01:00+00', '{"templateName": "GitHub API with Redis Cache"}'::jsonb, 
 '2025-11-25 14:01:00+00'),

('750e8400-e29b-41d4-a716-446655440024', 'exec_005', '650e8400-e29b-41d4-a716-446655440036', 
 'processing', 'in_progress', 'Designing workflow structure', 
 '2025-11-25 14:01:02+00', '{"nodes": ["Webhook", "Redis Get", "IF", "GitHub API", "Redis Set", "Merge"]}'::jsonb, 
 '2025-11-25 14:01:02+00'),

('750e8400-e29b-41d4-a716-446655440025', 'exec_005', '650e8400-e29b-41d4-a716-446655440036', 
 'processing', 'in_progress', 'Configuring Redis nodes', 
 '2025-11-25 14:01:04+00', '{"operations": ["get", "set"], "ttl": 300}'::jsonb, 
 '2025-11-25 14:01:04+00'),

('750e8400-e29b-41d4-a716-446655440026', 'exec_005', '650e8400-e29b-41d4-a716-446655440036', 
 'processing', 'in_progress', 'Setting up conditional logic', 
 '2025-11-25 14:01:06+00', '{"condition": "Cache hit check", "branches": ["hit", "miss"]}'::jsonb, 
 '2025-11-25 14:01:06+00'),

('750e8400-e29b-41d4-a716-446655440027', 'exec_005', '650e8400-e29b-41d4-a716-446655440036', 
 'processing', 'info', 'Adding GitHub API node', 
 '2025-11-25 14:01:08+00', '{"integration": "github", "operation": "generic_api_call"}'::jsonb, 
 '2025-11-25 14:01:08+00'),

('750e8400-e29b-41d4-a716-446655440028', 'exec_005', '650e8400-e29b-41d4-a716-446655440036', 
 'processing', 'info', 'Optimizing workflow connections', 
 '2025-11-25 14:01:10+00', '{"connections": 6, "branches": 2}'::jsonb, 
 '2025-11-25 14:01:10+00'),

('750e8400-e29b-41d4-a716-446655440029', 'exec_005', '650e8400-e29b-41d4-a716-446655440036', 
 'completion', 'completed', 'Template created successfully', 
 '2025-11-25 14:01:12+00', '{"templateId": "tpl_cache_001", "url": "https://n8n.example.com/workflow/new?template=tpl_cache_001", "duration": "12s"}'::jsonb, 
 '2025-11-25 14:01:12+00');

-- Additional standalone stream events (not linked to messages) for monitoring
INSERT INTO stream_events (id, execution_id, message_id, stage, status, message, timestamp, data, created_at) VALUES
-- Background workflow execution
('750e8400-e29b-41d4-a716-446655440030', 'exec_background_001', NULL, 
 'initialization', 'in_progress', 'Scheduled workflow started', 
 '2025-11-25 09:00:00+00', '{"workflowName": "Daily Standup Report", "trigger": "schedule"}'::jsonb, 
 '2025-11-25 09:00:00+00'),

('750e8400-e29b-41d4-a716-446655440031', 'exec_background_001', NULL, 
 'processing', 'in_progress', 'Fetching GitHub data', 
 '2025-11-25 09:00:02+00', '{"repository": "paragon-os/paragon-os-app"}'::jsonb, 
 '2025-11-25 09:00:02+00'),

('750e8400-e29b-41d4-a716-446655440032', 'exec_background_001', NULL, 
 'processing', 'info', 'Found 5 open issues and 3 pending PRs', 
 '2025-11-25 09:00:05+00', '{"issues": 5, "prs": 3, "commits": 12}'::jsonb, 
 '2025-11-25 09:00:05+00'),

('750e8400-e29b-41d4-a716-446655440033', 'exec_background_001', NULL, 
 'processing', 'in_progress', 'Formatting report', 
 '2025-11-25 09:00:07+00', '{"format": "markdown"}'::jsonb, 
 '2025-11-25 09:00:07+00'),

('750e8400-e29b-41d4-a716-446655440034', 'exec_background_001', NULL, 
 'processing', 'in_progress', 'Sending to Discord', 
 '2025-11-25 09:00:09+00', '{"channel": "daily-standups"}'::jsonb, 
 '2025-11-25 09:00:09+00'),

('750e8400-e29b-41d4-a716-446655440035', 'exec_background_001', NULL, 
 'completion', 'completed', 'Report sent successfully', 
 '2025-11-25 09:00:11+00', '{"duration": "11s", "status": "success"}'::jsonb, 
 '2025-11-25 09:00:11+00'),

-- Error example
('750e8400-e29b-41d4-a716-446655440036', 'exec_error_001', NULL, 
 'initialization', 'in_progress', 'Starting API integration workflow', 
 '2025-11-24 15:30:00+00', '{"workflowName": "External API Call"}'::jsonb, 
 '2025-11-24 15:30:00+00'),

('750e8400-e29b-41d4-a716-446655440037', 'exec_error_001', NULL, 
 'processing', 'in_progress', 'Calling external API', 
 '2025-11-24 15:30:02+00', '{"endpoint": "https://api.example.com/data"}'::jsonb, 
 '2025-11-24 15:30:02+00'),

('750e8400-e29b-41d4-a716-446655440038', 'exec_error_001', NULL, 
 'processing', 'error', 'API rate limit exceeded', 
 '2025-11-24 15:30:05+00', '{"error": "429 Too Many Requests", "retryAfter": 60}'::jsonb, 
 '2025-11-24 15:30:05+00'),

('750e8400-e29b-41d4-a716-446655440039', 'exec_error_001', NULL, 
 'completion', 'error', 'Workflow execution failed', 
 '2025-11-24 15:30:06+00', '{"duration": "6s", "status": "error", "errorType": "rate_limit"}'::jsonb, 
 '2025-11-24 15:30:06+00');

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Uncomment these to verify the seed data after loading

-- SELECT COUNT(*) as session_count FROM chat_sessions;
-- SELECT COUNT(*) as message_count FROM chat_messages;
-- SELECT COUNT(*) as event_count FROM stream_events;

-- SELECT 
--   cs.title,
--   cs.user_id,
--   COUNT(cm.id) as message_count,
--   cs.created_at,
--   cs.updated_at
-- FROM chat_sessions cs
-- LEFT JOIN chat_messages cm ON cs.id = cm.session_id
-- GROUP BY cs.id, cs.title, cs.user_id, cs.created_at, cs.updated_at
-- ORDER BY cs.updated_at DESC;

-- SELECT 
--   execution_id,
--   COUNT(*) as event_count,
--   MIN(timestamp) as start_time,
--   MAX(timestamp) as end_time,
--   MAX(timestamp) - MIN(timestamp) as duration
-- FROM stream_events
-- GROUP BY execution_id
-- ORDER BY start_time DESC;

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- This seed file creates:
-- - 7 chat sessions with diverse scenarios
-- - 39 chat messages across all sessions (conversations with context)
-- - 49 stream events showing workflow execution progress
--
-- Scenarios covered:
-- 1. Getting started with ParagonOS
-- 2. Workflow automation setup
-- 3. Debugging n8n integration issues
-- 4. Discord bot configuration
-- 5. Quick questions about features
-- 6. Advanced tool usage with performance analysis
-- 7. Empty session for testing
--
-- The data demonstrates:
-- - User/assistant conversations
-- - Tool calls and invocations
-- - Multi-step workflows
-- - Error handling
-- - Real-time stream monitoring
-- - Different user personas
-- - Various workflow execution patterns
-- ============================================================================

