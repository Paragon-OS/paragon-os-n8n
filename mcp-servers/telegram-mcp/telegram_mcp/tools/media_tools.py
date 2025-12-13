"""
Media: Send files/voice, download media, attachments, simple GIF/sticker helpers (concise, JSON).
"""

from mcp.server.fastmcp import FastMCP
from telethon import TelegramClient, functions, utils
from telethon.tl.types import *
import telethon.errors.rpcerrorlist
import logging
import json
import os
import mimetypes
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Union, Any

# Import shared utilities
from ..utils.helpers import format_entity, format_message, get_sender_name, json_serializer, get_entity_with_fallback
from ..utils.errors import log_and_format_error, ErrorCategory
from ..utils.media_storage import MediaStorage

# Import configuration
from ..config import client, logger

# Get logger
logger = logging.getLogger("telegram_mcp")

# Initialize media storage
media_storage = MediaStorage()


async def telegram_send_file(chat_id: int, file_path: str, caption: str = None) -> str:
    """Send a local file to a chat; returns ok/message."""
    try:
        if not os.path.isfile(file_path):
            return f"File not found: {file_path}"
        if not os.access(file_path, os.R_OK):
            return f"File is not readable: {file_path}"
        entity = await get_entity_with_fallback(client, chat_id)
        await client.send_file(entity, file_path, caption=caption)
        return json.dumps({"ok": True, "message": "File sent", "id": chat_id})
    except Exception as e:
        return log_and_format_error(
            "send_file", e, chat_id=chat_id, file_path=file_path, caption=caption
        )




async def telegram_download_media(chat_id: int, message_id: int, file_path: str = None) -> str:
    """Download message media / attachments; returns JSON with mime_type, size, path, resource_uri. path can be used to OCR images"""
    try:
        # Ensure client is connected and authenticated
        if not client.is_connected():
            await client.connect()
        if not await client.is_user_authorized():
            raise ValueError("Telegram client is not authorized. Please run the session generator first.")
        
        entity = await get_entity_with_fallback(client, chat_id)
        msg = await client.get_messages(entity, ids=message_id)
        if not msg or not msg.media:
            return "No media found in the specified message."
        
        # If file_path is provided, use the old behavior for backward compatibility
        if file_path:
            # Check if directory is writable
            dir_path = os.path.dirname(file_path) or "."
            if not os.access(dir_path, os.W_OK):
                return f"Directory not writable: {dir_path}"
            await client.download_media(msg, file=file_path)
            if not os.path.isfile(file_path):
                return f"Download failed: file not created at {file_path}"
            # Return JSON payload for specified file_path
            file_size = os.path.getsize(file_path)
            return json.dumps({
                "ok": True,
                "path": file_path,
                "size": file_size,
                "mime_type": None,
                "resource_uri": f"tgfile://{chat_id}/{message_id}",
            }, indent=2)
        
        # New behavior: save to persistent storage and return resource URI
        # Extract MIME type and extension from Telegram media object
        mime_type = None
        extension = None
        
        if hasattr(msg.media, 'photo'):
            mime_type = "image/jpeg"
            extension = ".jpg"
        elif hasattr(msg.media, 'document'):
            doc = msg.media.document
            mime_type = doc.mime_type or "application/octet-stream"
            # Get extension from filename or MIME type
            if doc.attributes:
                for attr in doc.attributes:
                    if hasattr(attr, 'file_name') and attr.file_name:
                        extension = os.path.splitext(attr.file_name)[1]
                        break
            
            # If no filename found, try to get extension from MIME type
            if not extension:
                ext_map = {
                    'image/jpeg': '.jpg',
                    'image/png': '.png',
                    'image/gif': '.gif',
                    'image/webp': '.webp',
                    'video/mp4': '.mp4',
                    'video/avi': '.avi',
                    'video/mov': '.mov',
                    'audio/mpeg': '.mp3',
                    'audio/ogg': '.ogg',
                    'application/pdf': '.pdf',
                    'text/plain': '.txt',
                }
                extension = ext_map.get(mime_type, '.bin')
        
        # Create temporary file for download with proper extension
        import tempfile
        suffix = extension or '.bin'
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = temp_file.name
        
        try:
            # Download media to temporary file
            await client.download_media(msg, file=temp_path)
            
            # Save to persistent storage with proper MIME type
            saved_path = media_storage.save_media(chat_id, message_id, temp_path, mime_type)
            
            file_size = os.path.getsize(saved_path)
            payload = {
                "ok": True,
                "mime_type": mime_type,
                "file": os.path.basename(saved_path),
                "size": file_size,
                "path": saved_path,
                "resource_uri": f"tgfile://{chat_id}/{message_id}",
            }
            return json.dumps(payload, indent=2, default=json_serializer)
            
        finally:
            # Clean up temporary file
            if os.path.exists(temp_path):
                os.unlink(temp_path)
                
    except Exception as e:
        return log_and_format_error(
            "download_media", e, chat_id=chat_id, message_id=message_id, file_path=file_path
        )




async def telegram_send_voice(chat_id: int, file_path: str) -> str:
    """Send a .ogg/.opus voice note; returns ok/message."""
    try:
        if not os.path.isfile(file_path):
            return f"File not found: {file_path}"
        if not os.access(file_path, os.R_OK):
            return f"File is not readable: {file_path}"
        mime, _ = mimetypes.guess_type(file_path)
        if not (
            mime
            and (
                mime == "audio/ogg"
                or file_path.lower().endswith(".ogg")
                or file_path.lower().endswith(".opus")
            )
        ):
            return "Voice file must be .ogg or .opus format."
        entity = await get_entity_with_fallback(client, chat_id)
        await client.send_file(entity, file_path, voice_note=True)
        return json.dumps({"ok": True, "message": "Voice message sent", "id": chat_id})
    except Exception as e:
        return log_and_format_error("telegram_send_voice", e, chat_id=chat_id, file_path=file_path)




async def telegram_get_media_info(chat_id: int, message_id: int) -> str:
    """Get basic media info for a message; returns JSON."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)
        msg = await client.get_messages(entity, ids=message_id)
        if not msg or not msg.media:
            return json.dumps({"media": None}, indent=2)
        info = {
            "type": type(msg.media).__name__,
        }
        # Attempt to include filename for documents
        if hasattr(msg.media, 'document') and getattr(msg.media, 'document', None):
            doc = msg.media.document
            if getattr(doc, 'attributes', None):
                for attr in doc.attributes:
                    if hasattr(attr, 'file_name') and attr.file_name:
                        info['file_name'] = attr.file_name
                        break
            info['mime_type'] = getattr(doc, 'mime_type', None)
            info['size'] = getattr(doc, 'size', None)
        return json.dumps(info, indent=2, default=json_serializer)
    except Exception as e:
        return log_and_format_error("telegram_get_media_info", e, chat_id=chat_id, message_id=message_id)




async def telegram_get_sticker_sets() -> str:
    """List available sticker sets (JSON titles)."""
    try:
        result = await client(functions.messages.GetAllStickersRequest(hash=0))
        return json.dumps([s.title for s in result.sets], indent=2)
    except Exception as e:
        return log_and_format_error("telegram_get_sticker_sets", e)




async def telegram_send_sticker(chat_id: int, file_path: str) -> str:
    """Send a .webp sticker; returns ok/message."""
    try:
        if not os.path.isfile(file_path):
            return f"Sticker file not found: {file_path}"
        if not os.access(file_path, os.R_OK):
            return f"Sticker file is not readable: {file_path}"
        if not file_path.lower().endswith(".webp"):
            return "Sticker file must be a .webp file."
        entity = await get_entity_with_fallback(client, chat_id)
        await client.send_file(entity, file_path, force_document=False)
        return json.dumps({"ok": True, "message": "Sticker sent", "id": chat_id})
    except Exception as e:
        return log_and_format_error("telegram_send_sticker", e, chat_id=chat_id, file_path=file_path)




async def telegram_get_gif_search(query: str, limit: int = 10) -> str:
    """Search GIFs; returns JSON array of Telegram document IDs."""
    try:
        # Try approach 1: SearchGifsRequest
        try:
            result = await client(
                functions.messages.SearchGifsRequest(q=query, offset_id=0, limit=limit)
            )
            if not result.gifs:
                return "[]"
            return json.dumps(
                [g.document.id for g in result.gifs], indent=2, default=json_serializer
            )
        except (AttributeError, ImportError):
            # Fallback approach: Use SearchRequest with GIF filter
            try:
                from telethon.tl.types import InputMessagesFilterGif

                result = await client(
                    functions.messages.SearchRequest(
                        peer="gif",
                        q=query,
                        filter=InputMessagesFilterGif(),
                        min_date=None,
                        max_date=None,
                        offset_id=0,
                        add_offset=0,
                        limit=limit,
                        max_id=0,
                        min_id=0,
                        hash=0,
                    )
                )
                if not result or not hasattr(result, "messages") or not result.messages:
                    return "[]"
                # Extract document IDs from any messages with media
                gif_ids = []
                for msg in result.messages:
                    if hasattr(msg, "media") and msg.media and hasattr(msg.media, "document"):
                        gif_ids.append(msg.media.document.id)
                return json.dumps(gif_ids, default=json_serializer)
            except Exception as inner_e:
                # Last resort: Try to fetch from a public bot
                return f"Could not search GIFs using available methods: {inner_e}"
    except Exception as e:
        logger.exception(f"telegram_get_gif_search failed (query={query}, limit={limit})")
        return log_and_format_error("telegram_get_gif_search", e, query=query, limit=limit)




async def telegram_send_gif(chat_id: int, gif_id: int) -> str:
    """Send a GIF by Telegram document ID; returns ok/message."""
    try:
        if not isinstance(gif_id, int):
            return "gif_id must be a Telegram document ID (integer), not a file path. Use get_gif_search to find IDs."
        entity = await get_entity_with_fallback(client, chat_id)
        await client.send_file(entity, gif_id)
        return json.dumps({"ok": True, "message": "GIF sent", "id": chat_id})
    except Exception as e:
        return log_and_format_error("telegram_send_gif", e, chat_id=chat_id, gif_id=gif_id)


async def telegram_list_downloaded_media() -> str:
    """List downloaded media files in persistent storage as JSON."""
    try:
        media_list = media_storage.list_media()
        if not media_list:
            return json.dumps({"items": [], "stats": media_storage.get_storage_stats()}, indent=2)

        items = []
        for media in media_list:
            items.append({
                "chat_id": media['chat_id'],
                "message_id": media['message_id'],
                "file": os.path.basename(media['path']),
                "mime_type": media['mime_type'],
                "size": media['size'],
                "path": media['path'],
                "timestamp": media['timestamp'],
            })

        stats = media_storage.get_storage_stats()
        return json.dumps({"items": items, "stats": stats}, indent=2)
        
    except Exception as e:
        return log_and_format_error("telegram_list_downloaded_media", e)


async def telegram_clear_downloaded_media(chat_id: int = None, message_id: int = None) -> str:
    """Clear downloaded media cache; returns ok/message and counts."""
    try:
        if chat_id is not None and message_id is not None:
            # Clear specific media file
            success = media_storage.delete_media(chat_id, message_id)
            if success:
                return json.dumps({"ok": True, "message": "Cleared media file", "chat_id": chat_id, "message_id": message_id})
            else:
                return json.dumps({"ok": False, "message": "No media file found", "chat_id": chat_id, "message_id": message_id})
        
        elif chat_id is not None:
            # Clear all media from specific chat
            media_list = media_storage.list_media()
            cleared_count = 0
            
            for media in media_list:
                if media['chat_id'] == chat_id:
                    media_storage.delete_media(media['chat_id'], media['message_id'])
                    cleared_count += 1

            return json.dumps({"ok": True, "message": "Cleared chat media", "chat_id": chat_id, "count": cleared_count})
        
        else:
            # Clear all media
            cleared_count = media_storage.clear_all_media()
            return json.dumps({"ok": True, "message": "Cleared all media", "count": cleared_count})
            
    except Exception as e:
        return log_and_format_error("telegram_clear_downloaded_media", e, chat_id=chat_id, message_id=message_id)



