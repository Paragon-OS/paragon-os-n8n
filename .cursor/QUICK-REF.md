# Quick Reference Card

> **1-minute read for AI assistants**

## ✅ DO's

```typescript
// ✅ Use CLI for credentials
const cred = [{ id: "exact-id", name: "...", type: "...", data: {...} }];
podman exec container n8n import:credentials --input /tmp/cred.json

// ✅ Array format
[{...}]  // Correct

// ✅ Cleanup containers
afterEach(async () => {
  await stopN8nInstance(instance);
});

// ✅ Random ports
const port = await findAvailablePort();
```

## ❌ DON'Ts

```typescript
// ❌ Don't use REST API for credentials
await axios.post('/rest/credentials', {...});  // Random IDs!

// ❌ Don't use single object
{...}  // Wrong format

// ❌ Don't retry API key scopes
scopes: ['workflow:read', ...]  // All attempts fail

// ❌ Don't skip cleanup
// Always cleanup containers!
```

## 🐛 Debug Commands

```bash
# Cleanup
npm run test:cleanup

# View logs
tail -100 /tmp/n8n-tests/test_*.log

# Check containers
podman ps --filter 'name=n8n-test'

# Force cleanup
podman rm -f $(podman ps -aq --filter 'name=n8n-test')
```

## 📚 Read More

- `ai-context.md` - Full debugging journal
- `SUMMARY.md` - Quick summary
- `README.md` - About this directory

## 🎯 Key Files

- `src/utils/n8n-credentials.ts` - Credential management
- `src/utils/n8n-setup.ts` - Setup orchestration
- `src/utils/n8n-podman.ts` - Container management

## ⚡ Common Issues

| Issue | Solution |
|-------|----------|
| Port conflict | `npm run test:cleanup` |
| Test hangs | Ctrl+C, then cleanup |
| Credential import fails | Check array format `[{...}]` |
| API key fails | Expected - use session cookies |

## 🎓 Remember

1. **CLI > REST API** for credentials
2. **Array format** required
3. **Always cleanup** containers
4. **Don't retry** API key scopes
5. **Read ai-context.md** for details

