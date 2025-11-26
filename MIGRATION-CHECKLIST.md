# Chat Schema Refactoring - Migration Checklist

## Pre-Migration

- [ ] **Backup your database**
  ```bash
  # Create a backup before proceeding
  supabase db dump > backup-$(date +%Y%m%d-%H%M%S).sql
  ```

- [ ] **Review the changes**
  - Read `REFACTORING-SUMMARY.md`
  - Review `supabase/migrations/20251126000000_refactor_chat_schema.sql`
  - Understand breaking changes

- [ ] **Check for custom code**
  - Search for any code referencing `session_id` (TEXT)
  - Search for any code referencing `message_id` (TEXT)
  - Search for any code using `metadata` field
  - Search for any code using `content_parts`, `tool_calls`, `tool_invocations`

## Migration Steps

### 1. Apply Database Migration

- [ ] **Start Supabase** (if using local)
  ```bash
  npm run db:start
  ```

- [ ] **Apply migration**
  ```bash
  npm run db:migrate
  ```
  
  Or manually:
  ```bash
  supabase db reset
  ```

- [ ] **Verify migration applied**
  ```bash
  npm run db:status
  ```

### 2. Verify Data Migration

- [ ] **Run verification script**
  ```bash
  npm run migrate-chat-data
  ```

- [ ] **Check output for errors**
  - Should show: ✅ Migration verification completed successfully
  - If errors, review and fix before proceeding

- [ ] **Manually verify in Supabase Studio**
  - Open http://localhost:54323 (local) or your Supabase dashboard
  - Check `chat_sessions` table structure
  - Check `chat_messages` table structure
  - Check `stream_events` table structure
  - Verify data looks correct

### 3. Test Application

- [ ] **Run tests**
  ```bash
  npm test
  ```

- [ ] **Start dev server**
  ```bash
  npm run dev
  ```

- [ ] **Test key features**
  - [ ] Create a new chat session
  - [ ] Send messages
  - [ ] Load existing sessions
  - [ ] Delete a session
  - [ ] Check that messages persist
  - [ ] Verify stream events work

### 4. Update External Code (if any)

- [ ] **API clients**
  - Update any external API clients to use new field names
  - `session_id` → `id`
  - `message_id` → `id`

- [ ] **Webhooks**
  - Update webhook handlers if they reference old schema

- [ ] **Analytics/Monitoring**
  - Update any queries or dashboards using old field names

## Post-Migration

### Verification

- [ ] **Check logs for errors**
  ```bash
  # Check application logs
  # Check Supabase logs
  ```

- [ ] **Monitor performance**
  - Check query performance
  - Verify indexes are being used
  - Monitor write performance

- [ ] **Test edge cases**
  - [ ] Empty messages
  - [ ] Messages with tools
  - [ ] Long conversations
  - [ ] Concurrent session creation
  - [ ] Rapid message sending

### Cleanup

- [ ] **Remove old code** (if any fallback code exists)
  - Remove any code that handled old schema
  - Remove compatibility layers

- [ ] **Update documentation**
  - Update API documentation
  - Update developer guides
  - Update README if needed

- [ ] **Archive backup**
  - Store backup in safe location
  - Document backup location
  - Set reminder to delete old backups after X days

## Rollback Plan

If something goes wrong:

### Option 1: Restore from Backup
```bash
# Stop Supabase
npm run db:stop

# Restore from backup
psql -h localhost -p 54322 -U postgres < backup-YYYYMMDD-HHMMSS.sql

# Start Supabase
npm run db:start
```

### Option 2: Revert Code Changes
```bash
# Find the commit before migration
git log --oneline

# Revert the changes
git revert <commit-hash>

# Restore database from backup
```

### Option 3: Manual Rollback
1. Drop new tables
2. Recreate old schema
3. Restore data from backup
4. Revert code changes

## Troubleshooting

### Migration fails with "relation does not exist"
- Ensure Supabase is running
- Check that previous migrations are applied
- Try `supabase db reset`

### Data looks incorrect after migration
- Check migration SQL for errors
- Restore from backup
- Review data transformation logic in migration

### Application throws errors about missing fields
- Check that all code is updated to use new field names
- Search for `session_id`, `message_id`, `metadata` references
- Update any missed locations

### Foreign key constraint violations
- Check that all messages reference valid sessions
- Check that all stream events reference valid messages
- Run verification script to identify orphaned records

### Performance issues
- Check that indexes were created correctly
- Run `EXPLAIN ANALYZE` on slow queries
- Verify query plans are using indexes

## Success Criteria

✅ Migration is successful when:
- [ ] All tests pass
- [ ] Application runs without errors
- [ ] Data is intact and accessible
- [ ] Performance is same or better
- [ ] No orphaned records
- [ ] Foreign keys working correctly
- [ ] Realtime subscriptions working
- [ ] Stream events properly linked

## Support

If you encounter issues:
1. Check this checklist
2. Review `REFACTORING-SUMMARY.md`
3. Check application logs
4. Check Supabase logs
5. Review migration SQL
6. Restore from backup if needed

## Timeline

Estimated time for migration:
- **Backup**: 5 minutes
- **Apply migration**: 2-5 minutes
- **Verify migration**: 5 minutes
- **Test application**: 15-30 minutes
- **Update external code**: Variable
- **Total**: ~30-60 minutes

## Notes

- This is a **breaking change** - plan accordingly
- Test thoroughly in development before production
- Have rollback plan ready
- Monitor closely after deployment
- Keep backup for at least 7 days

---

**Last Updated**: November 26, 2025
**Migration Version**: 20251126000000_refactor_chat_schema

