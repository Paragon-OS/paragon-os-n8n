"""
Integration test for Telegram MCP server running in a container.

Starts a podman container, sends MCP JSON-RPC requests, and verifies the tool list.

Usage:
    pytest tests/test_mcp_container.py -v
    python tests/test_mcp_container.py  # standalone
"""

import json
import subprocess
import time
import os
from pathlib import Path


MCP_REQUESTS = [
    {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "test", "version": "1.0.0"},
        },
    },
    {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
]

EXPECTED_TOOL_CATEGORIES = {
    "chat": [
        "telegram_get_chats",
        "telegram_list_chats",
        "telegram_get_chat",
        "telegram_create_group",
        "telegram_leave_chat",
    ],
    "message": [
        "telegram_send_message",
        "telegram_get_messages",
        "telegram_edit_message",
        "telegram_delete_message",
    ],
    "contact": [
        "telegram_list_contacts",
        "telegram_add_contact",
        "telegram_block_user",
    ],
    "media": [
        "telegram_send_file",
        "telegram_download_media",
        "telegram_send_voice",
    ],
    "admin": [
        "telegram_get_participants",
        "telegram_ban_user",
        "telegram_promote_admin",
    ],
    "profile": [
        "telegram_get_me",
        "telegram_update_profile",
    ],
    "reaction": [
        "telegram_react_to_message",
        "telegram_get_message_reactions",
    ],
    "misc": [
        "telegram_mute_chat",
        "telegram_resolve_username",
    ],
}


def get_project_root() -> Path:
    """Get the project root directory."""
    return Path(__file__).parent.parent


def build_container(container_runtime: str = "podman") -> bool:
    """Build the MCP container image."""
    project_root = get_project_root()
    result = subprocess.run(
        [container_runtime, "build", "-t", "telegram-mcp-test", "."],
        cwd=project_root,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def query_mcp_tools(container_runtime: str = "podman", timeout: float = 60.0) -> dict:
    """
    Start MCP container, send requests, and return the tools list response.

    Returns:
        dict with 'initialize_response', 'tools_response', and 'tools' keys
    """
    project_root = get_project_root()
    env_file = project_root / ".env"

    if not env_file.exists():
        raise FileNotFoundError(f".env file not found at {env_file}")

    # Prepare JSON-RPC requests as newline-delimited input
    input_data = "\n".join(json.dumps(req) for req in MCP_REQUESTS) + "\n"

    # Start container with stdin pipe
    proc = subprocess.Popen(
        [
            container_runtime,
            "run",
            "--rm",
            "-i",
            "--env-file",
            str(env_file),
            "telegram-mcp-test",
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=project_root,
    )

    stdout_lines = []
    try:
        # Send requests and close stdin to signal EOF
        proc.stdin.write(input_data)
        proc.stdin.close()

        # Read stdout with timeout - collect JSON responses
        start_time = time.time()
        while time.time() - start_time < timeout:
            line = proc.stdout.readline()
            if not line:
                # Check if process ended
                if proc.poll() is not None:
                    break
                time.sleep(0.1)
                continue

            line = line.strip()
            if line.startswith("{"):
                stdout_lines.append(line)
                # We expect 2 responses, exit early once we have them
                if len(stdout_lines) >= 2:
                    break

        if len(stdout_lines) < 2:
            stderr = proc.stderr.read() if proc.stderr else ""
            raise TimeoutError(
                f"Expected 2 responses, got {len(stdout_lines)}. stderr: {stderr[:500]}"
            )

    finally:
        proc.kill()
        proc.wait()

    # Parse JSON-RPC responses
    responses = []
    for line in stdout_lines:
        try:
            responses.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    init_response = responses[0]
    tools_response = responses[1]

    tools = []
    if "result" in tools_response and "tools" in tools_response["result"]:
        tools = tools_response["result"]["tools"]

    return {
        "initialize_response": init_response,
        "tools_response": tools_response,
        "tools": tools,
        "tool_names": [t["name"] for t in tools],
    }


def cleanup_containers(container_runtime: str = "podman"):
    """Remove any lingering test containers."""
    subprocess.run(
        [container_runtime, "rm", "-f"]
        + subprocess.run(
            [container_runtime, "ps", "-aq", "--filter", "ancestor=telegram-mcp-test"],
            capture_output=True,
            text=True,
        ).stdout.split(),
        capture_output=True,
    )


# --- Pytest test functions ---


def test_container_builds():
    """Test that the container builds successfully."""
    assert build_container(), "Container build failed"


def test_mcp_initialize():
    """Test that MCP server initializes correctly."""
    result = query_mcp_tools()
    init_resp = result["initialize_response"]

    assert "result" in init_resp, "Initialize response missing 'result'"
    assert init_resp["result"]["protocolVersion"] == "2024-11-05"
    assert init_resp["result"]["serverInfo"]["name"] == "telegram"


def test_mcp_tools_list():
    """Test that MCP server returns expected tools."""
    result = query_mcp_tools()
    tool_names = result["tool_names"]

    # Check we have a reasonable number of tools
    assert len(tool_names) >= 70, f"Expected 70+ tools, got {len(tool_names)}"

    # Check tools from each category exist
    for category, expected_tools in EXPECTED_TOOL_CATEGORIES.items():
        for tool in expected_tools:
            assert tool in tool_names, f"Missing {category} tool: {tool}"


def test_tool_schemas():
    """Test that tools have valid input schemas."""
    result = query_mcp_tools()

    for tool in result["tools"]:
        assert "name" in tool, "Tool missing 'name'"
        assert "description" in tool, f"Tool {tool['name']} missing 'description'"
        assert "inputSchema" in tool, f"Tool {tool['name']} missing 'inputSchema'"
        assert tool["inputSchema"].get("type") == "object", (
            f"Tool {tool['name']} inputSchema should be object type"
        )


# --- Standalone runner ---


if __name__ == "__main__":
    print("Building container...")
    if not build_container():
        print("ERROR: Container build failed")
        exit(1)
    print("Container built successfully\n")

    print("Querying MCP server...")
    try:
        result = query_mcp_tools()
        print(f"Server: {result['initialize_response']['result']['serverInfo']}")
        print(f"Tools found: {len(result['tools'])}\n")

        print("Tools by category:")
        for category, tools in EXPECTED_TOOL_CATEGORIES.items():
            found = sum(1 for t in tools if t in result["tool_names"])
            print(f"  {category}: {found}/{len(tools)} expected tools found")

        print("\nAll tool names:")
        for name in sorted(result["tool_names"]):
            print(f"  - {name}")

    except Exception as e:
        print(f"ERROR: {e}")
        exit(1)
    finally:
        cleanup_containers()
        print("\nCleanup complete")
