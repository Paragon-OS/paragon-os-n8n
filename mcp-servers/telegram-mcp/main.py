"""
Telegram MCP Server - Main Entry Point
Refactored from monolithic main.py
"""

import asyncio
import sys
import sqlite3
import nest_asyncio
import os
import mimetypes
import signal
import atexit
from mcp.server.fastmcp import FastMCP
from mcp.types import BlobResourceContents

# Import configuration
from telegram_mcp.config import client, logger

# Import media storage
from telegram_mcp.utils.media_storage import MediaStorage

# Initialize MCP server
mcp = FastMCP("telegram")

# Initialize media storage
media_storage = MediaStorage()

# Import all tool modules to register them
from telegram_mcp.tools import chat_tools
from telegram_mcp.tools import message_tools
from telegram_mcp.tools import contact_tools
from telegram_mcp.tools import media_tools
from telegram_mcp.tools import admin_tools
from telegram_mcp.tools import profile_tools
from telegram_mcp.tools import misc_tools
from telegram_mcp.tools import reaction_tools

# Register all tools with the MCP server
def register_tools():
    """Register all tools from the various modules."""
    
    # Chat tools
    mcp.tool()(chat_tools.telegram_get_chats)
    mcp.tool()(chat_tools.telegram_list_chats)
    mcp.tool()(chat_tools.telegram_get_chat)
    mcp.tool()(chat_tools.telegram_read_channel)
    mcp.tool()(chat_tools.telegram_create_group)
    mcp.tool()(chat_tools.telegram_create_channel)
    mcp.tool()(chat_tools.telegram_edit_chat_title)
    mcp.tool()(chat_tools.telegram_edit_chat_photo)
    mcp.tool()(chat_tools.telegram_delete_chat_photo)
    mcp.tool()(chat_tools.telegram_leave_chat)
    mcp.tool()(chat_tools.telegram_get_pending_chats)
    mcp.tool()(chat_tools.telegram_get_direct_chat_by_contact)
    mcp.tool()(chat_tools.telegram_get_contact_chats)
    mcp.tool()(chat_tools.telegram_join_chat_by_link)
    mcp.tool()(chat_tools.telegram_export_chat_invite)
    mcp.tool()(chat_tools.telegram_import_chat_invite)
    mcp.tool()(chat_tools.telegram_get_invite_link)
    mcp.tool()(chat_tools.telegram_archive_chat)
    mcp.tool()(chat_tools.telegram_unarchive_chat)
    
    # Message tools
    mcp.tool()(message_tools.telegram_get_messages)
    mcp.tool()(message_tools.telegram_list_messages)
    mcp.tool()(message_tools.telegram_send_message)
    mcp.tool()(message_tools.telegram_reply_to_message)
    mcp.tool()(message_tools.telegram_edit_message)
    mcp.tool()(message_tools.telegram_delete_message)
    mcp.tool()(message_tools.telegram_forward_message)
    mcp.tool()(message_tools.telegram_pin_message)
    mcp.tool()(message_tools.telegram_unpin_message)
    mcp.tool()(message_tools.telegram_mark_as_read)
    mcp.tool()(message_tools.telegram_get_message_context)
    mcp.tool()(message_tools.telegram_search_messages)
    mcp.tool()(message_tools.telegram_get_history)
    mcp.tool()(message_tools.telegram_get_pinned_messages)
    mcp.tool()(message_tools.telegram_create_poll)
    
    # Reaction tools
    mcp.tool()(reaction_tools.telegram_react_to_message)
    mcp.tool()(reaction_tools.telegram_unreact_message)
    mcp.tool()(reaction_tools.telegram_get_message_reactions)
    mcp.tool()(reaction_tools.telegram_get_reactors)
    
    # Contact tools
    mcp.tool()(contact_tools.telegram_list_contacts)
    mcp.tool()(contact_tools.telegram_search_contacts)
    # Deprecated registrations gated by env flag
    if os.getenv("TELEGRAM_MCP_INCLUDE_DEPRECATED", "false").lower() in ("1", "true", "yes"): 
        mcp.tool()(contact_tools.telegram_get_contact_ids)
    mcp.tool()(contact_tools.telegram_add_contact)
    mcp.tool()(contact_tools.telegram_delete_contact)
    mcp.tool()(contact_tools.telegram_block_user)
    mcp.tool()(contact_tools.telegram_unblock_user)
    mcp.tool()(contact_tools.telegram_get_blocked_users)
    mcp.tool()(contact_tools.telegram_import_contacts)
    mcp.tool()(contact_tools.telegram_export_contacts)
    mcp.tool()(contact_tools.telegram_get_last_interaction)
    
    # Media tools
    mcp.tool()(media_tools.telegram_send_file)
    mcp.tool()(media_tools.telegram_download_media)
    mcp.tool()(media_tools.telegram_send_voice)
    mcp.tool()(media_tools.telegram_send_sticker)
    mcp.tool()(media_tools.telegram_send_gif)
    mcp.tool()(media_tools.telegram_get_gif_search)
    mcp.tool()(media_tools.telegram_get_media_info)
    mcp.tool()(media_tools.telegram_get_sticker_sets)
    mcp.tool()(media_tools.telegram_list_downloaded_media)
    mcp.tool()(media_tools.telegram_clear_downloaded_media)
    
    # Admin tools
    mcp.tool()(admin_tools.telegram_get_participants)
    mcp.tool()(admin_tools.telegram_invite_to_group)
    mcp.tool()(admin_tools.telegram_promote_admin)
    mcp.tool()(admin_tools.telegram_demote_admin)
    mcp.tool()(admin_tools.telegram_ban_user)
    mcp.tool()(admin_tools.telegram_unban_user)
    mcp.tool()(admin_tools.telegram_get_admins)
    mcp.tool()(admin_tools.telegram_get_banned_users)
    mcp.tool()(admin_tools.telegram_get_recent_actions)
    
    # Profile tools
    mcp.tool()(profile_tools.telegram_get_me)
    mcp.tool()(profile_tools.telegram_update_profile)
    mcp.tool()(profile_tools.telegram_set_profile_photo)
    mcp.tool()(profile_tools.telegram_delete_profile_photo)
    mcp.tool()(profile_tools.telegram_get_privacy_settings)
    mcp.tool()(profile_tools.telegram_set_privacy_settings)
    mcp.tool()(profile_tools.telegram_get_user_photos)
    mcp.tool()(profile_tools.telegram_get_user_status)
    
    # Misc tools
    mcp.tool()(misc_tools.telegram_mute_chat)
    mcp.tool()(misc_tools.telegram_unmute_chat)
    mcp.tool()(misc_tools.telegram_search_public_chats)
    mcp.tool()(misc_tools.telegram_resolve_username)
    mcp.tool()(misc_tools.telegram_get_bot_info)
    mcp.tool()(misc_tools.telegram_set_bot_commands)
    mcp.tool()(misc_tools.telegram_list_topics)

# Register all tools
register_tools()

# MCP Resource handler for Telegram media
@mcp.resource("tgfile://{chat_id}/{message_id}")
async def get_telegram_media(chat_id: str, message_id: str):
    """
    MCP Resource that returns raw bytes and MIME type for downloaded Telegram media.
    Claude Desktop can fetch this via read_resource.
    """
    try:
        chat_id_int = int(chat_id)
        message_id_int = int(message_id)
        
        media_info = media_storage.get_media(chat_id_int, message_id_int)
        if not media_info:
            raise ValueError(f"Media not found: {chat_id}/{message_id}. Download it first.")
        
        file_path = media_info["path"]
        if not os.path.exists(file_path):
            raise ValueError(f"Media file not found at {file_path}")
        
        with open(file_path, 'rb') as f:
            blob_data = f.read()
        
        # Encode blob as base64 string
        import base64
        blob_b64 = base64.b64encode(blob_data).decode('utf-8')
        
        resource_uri = f"tgfile://{chat_id}/{message_id}"
        logger.info(f"Serving media resource: {len(blob_data)} bytes, {media_info['mime_type']}")
        return [BlobResourceContents(
            uri=resource_uri,
            blob=blob_b64,
            mimeType=media_info["mime_type"]
        )]
        
    except Exception as e:
        logger.error(f"Resource error {chat_id}/{message_id}: {e}")
        raise ValueError(f"Failed to serve media resource: {e}")

# Global flag to track shutdown
_shutdown_requested = False
_shutdown_event = None

async def cleanup():
    """Cleanup function to properly close the Telegram client."""
    try:
        if client.is_connected():
            logger.info("Disconnecting Telegram client...")
            await client.disconnect()
            logger.info("Telegram client disconnected")
    except Exception as e:
        logger.error(f"Error during cleanup: {e}")

if __name__ == "__main__":
    nest_asyncio.apply()

    async def main() -> None:
        global _shutdown_requested, _shutdown_event
        
        _shutdown_event = asyncio.Event()
        
        def signal_handler(sig, frame):
            """Handle shutdown signals gracefully."""
            logger.info(f"Received signal {sig}, initiating shutdown...")
            _shutdown_requested = True
            if _shutdown_event:
                _shutdown_event.set()
        
        # Register signal handlers
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
        
        try:
            # Start the Telethon client non-interactively
            print("Starting Telegram client...")
            await client.start()

            if _shutdown_requested:
                logger.info("Shutdown requested before server started")
                await cleanup()
                return

            print("Telegram client started. Running MCP server...")
            # Use the asynchronous entrypoint instead of mcp.run()
            await mcp.run_stdio_async()
        except KeyboardInterrupt:
            logger.info("Interrupted by user")
        except Exception as e:
            logger.error(f"Error in main loop: {e}")
            print(f"Error starting client: {e}", file=sys.stderr)
            if isinstance(e, sqlite3.OperationalError) and "database is locked" in str(e):
                print(
                    "Database lock detected. Please ensure no other instances are running.",
                    file=sys.stderr,
                )
        finally:
            await cleanup()
            sys.exit(0)

    asyncio.run(main())
