# Post-Migration Notes

## ✅ Migration Completed Successfully

The database schema refactoring has been applied successfully. All code has been updated to use the new schema.

## ⚠️ Important: Session ID Format Changed

### What Changed
- **Old format**: `session-1764128628763-3ia1l124` (TEXT with prefix)
- **New format**: `550e8400-e29b-41d4-a716-446655440000` (UUID)

### Current Issue
If you see an error like:
```
invalid input syntax for type uuid: "session-1764128628763-3ia1l124"
```

This means your browser is trying to use an old session ID with the new database schema.

### Solutions

#### Option 1: Clear Browser Storage (Recommended)
1. Open browser DevTools (F12)
2. Go to Application/Storage tab
3. Clear Local Storage and Session Storage
4. Refresh the page
5. A new session with UUID format will be created

#### Option 2: Create New Session
1. Click "New Chat" button in the UI
2. This will create a new session with proper UUID format

#### Option 3: Manual Cleanup
```javascript
// Run in browser console
localStorage.clear();
sessionStorage.clear();
location.reload();
```

## Files Updated

### Session ID Generation
- ✅ `app/api/chat/route.ts` - Now generates UUID session IDs
- ✅ `components/assistant-ui/chat-sessions-context.tsx` - Uses `randomUUID()`
- ✅ `lib/chat/services/session-manager.ts` - Uses `randomUUID()`

### Schema Updates
- ✅ All database queries updated to use `id` instead of `session_id`/`message_id`
- ✅ All TypeScript types updated
- ✅ All components updated

## Verification Steps

1. **Clear browser storage** (see above)
2. **Refresh the application**
3. **Create a new chat session**
4. **Send a message**
5. **Verify in Supabase Studio**:
   - Check `chat_sessions` table - should have UUID `id`
   - Check `chat_messages` table - should have UUID `id` and `session_id`
   - Check `stream_events` table - should have UUID `message_id`

## Database Schema Summary

### chat_sessions
```sql
id UUID PRIMARY KEY          -- UUID only, no TEXT session_id
user_id TEXT
title TEXT
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

### chat_messages
```sql
id UUID PRIMARY KEY          -- UUID only, no TEXT message_id
session_id UUID FK           -- References chat_sessions(id)
role TEXT
content JSONB                -- Array format
tools JSONB                  -- {calls: [], invocations: []}
execution_id TEXT
created_at TIMESTAMPTZ
```

### stream_events
```sql
id UUID PRIMARY KEY
execution_id TEXT
message_id UUID FK           -- References chat_messages(id)
stage TEXT
status TEXT
message TEXT
timestamp TEXT
data JSONB
created_at TIMESTAMPTZ
```

## Next Steps

1. ✅ Clear browser storage
2. ✅ Test creating new sessions
3. ✅ Test sending messages
4. ✅ Test loading historical sessions
5. ✅ Verify data in Supabase Studio

## Rollback (if needed)

If you need to rollback:
```bash
# Restore from backup
supabase db reset --db-url <backup-url>

# Or revert code changes
git revert <commit-hash>
```

## Support

If you encounter issues:
1. Check browser console for errors
2. Check Supabase logs
3. Verify migration was applied: `npm run db:status`
4. Run verification script: `npm run migrate-chat-data`

