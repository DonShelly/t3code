This launcher is added to the T3 nightly fork under `integrations/meta-harness/`.
It starts the installed persistent controller dashboard without modifying T3's
database, provider credentials, ports, or running installation.

```powershell
python -m pip install -e C:\Users\donshelly\Projects\meta-harness
node integrations/meta-harness/launch.mjs
```

In T3, add a project script for the command above with preview URL
`http://127.0.0.1:4317/`. The dashboard asks for the token in
`~/.meta-harness/dashboard-token`. It is a local read-only console; remote clients
need an authenticated tunnel or a future T3-native transport integration.

The agent-facing interface is an MCP stdio process:

```json
{"mcpServers":{"meta-harness":{"command":"python","args":["-m","meta_harness","mcp"]}}}
```

It provides persistent context and task proposals. Dispatch, policy editing,
architecture approval, and integration are controller operations, not worker tools.

Gas City already has a native `t3bridge` session provider. Its existing example
is the appropriate starting point for a Linux deployment; it is not replaced by
this launcher. This Windows installation runs Claude CLI workers directly using
the confirmed ELSOLVE subscription login. It does not claim those CLI workers are
T3-owned delegated tasks.
