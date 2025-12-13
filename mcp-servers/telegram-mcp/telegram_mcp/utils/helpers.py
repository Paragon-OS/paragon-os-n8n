"""
Helper functions for Telegram MCP
Auto-generated from main.py refactoring
"""

import json
from datetime import datetime
from typing import Dict, Any, Optional, Union
from telethon.tl.types import User, Chat, Channel
from telethon import utils, TelegramClient

async def get_entity_with_fallback(client: TelegramClient, entity_id: Union[int, str]):
    """
    Get entity with automatic fallback to negative ID for groups.
    
    This handles cases where groups are provided with positive IDs (should be negative).
    Telegram groups often require negative IDs, so if a positive ID fails, we try the negative.
    
    Args:
        client: The TelegramClient instance
        entity_id: The entity ID (can be int or string like username)
    
    Returns:
        The entity object
    
    Raises:
        ValueError: If entity cannot be found with either ID
    """
    try:
        return await client.get_entity(entity_id)
    except (ValueError, Exception) as original_error:
        # Only try negative ID fallback for positive integer IDs
        if isinstance(entity_id, int) and entity_id > 0:
            try:
                return await client.get_entity(-entity_id)
            except Exception:
                # If negative ID also fails, raise the original error
                raise original_error
        # For non-integer IDs or negative IDs, just raise the original error
        raise original_error


def json_serializer(obj):
    """Helper function to convert non-serializable objects for JSON serialization."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    # Add other non-serializable types as needed
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")

def format_entity(entity) -> Dict[str, Any]:
    """Helper function to format entity information consistently."""
    result = {"id": entity.id}

    if hasattr(entity, "title"):
        result["name"] = entity.title
        result["type"] = "group" if isinstance(entity, Chat) else "channel"
    elif hasattr(entity, "first_name"):
        name_parts = []
        if entity.first_name:
            name_parts.append(entity.first_name)
        if hasattr(entity, "last_name") and entity.last_name:
            name_parts.append(entity.last_name)
        result["name"] = " ".join(name_parts)
        result["type"] = "user"
        if hasattr(entity, "username") and entity.username:
            result["username"] = entity.username
        if hasattr(entity, "phone") and entity.phone:
            result["phone"] = entity.phone

    return result

def format_message(message) -> Dict[str, Any]:
    """Helper function to format message information consistently."""
    result = {
        "id": message.id,
        "date": message.date.isoformat(),
        "text": message.message or "",
    }

    if message.from_id:
        result["from_id"] = utils.get_peer_id(message.from_id)

    if message.media:
        result["has_media"] = True
        result["media_type"] = type(message.media).__name__
        
        # Add detailed media information
        media_details = {}
        
        # Handle photos
        if hasattr(message.media, 'photo') and message.media.photo:
            photo = message.media.photo
            media_details["photo_id"] = getattr(photo, 'id', None)
            if hasattr(photo, 'sizes') and photo.sizes:
                # Get largest photo size
                largest = max(photo.sizes, key=lambda s: getattr(s, 'size', 0) if hasattr(s, 'size') else 0)
                if hasattr(largest, 'w') and hasattr(largest, 'h'):
                    media_details["dimensions"] = {"width": largest.w, "height": largest.h}
                if hasattr(largest, 'size'):
                    media_details["size"] = largest.size
        
        # Handle documents (files, videos, audio, etc.)
        elif hasattr(message.media, 'document') and message.media.document:
            doc = message.media.document
            media_details["document_id"] = getattr(doc, 'id', None)
            media_details["mime_type"] = getattr(doc, 'mime_type', None)
            media_details["size"] = getattr(doc, 'size', None)
            
            # Extract attributes (filename, duration, dimensions, etc.)
            if hasattr(doc, 'attributes') and doc.attributes:
                for attr in doc.attributes:
                    # File name
                    if hasattr(attr, 'file_name') and attr.file_name:
                        media_details["file_name"] = attr.file_name
                    # Video/audio duration
                    if hasattr(attr, 'duration'):
                        media_details["duration"] = attr.duration
                    # Video dimensions
                    if hasattr(attr, 'w') and hasattr(attr, 'h'):
                        media_details["dimensions"] = {"width": attr.w, "height": attr.h}
                    # Audio metadata
                    if hasattr(attr, 'title') and attr.title:
                        media_details["title"] = attr.title
                    if hasattr(attr, 'performer') and attr.performer:
                        media_details["performer"] = attr.performer
                    # Sticker info
                    if hasattr(attr, 'stickerset'):
                        media_details["is_sticker"] = True
                    # Voice message
                    if hasattr(attr, 'voice'):
                        media_details["is_voice"] = True
        
        # Handle web pages
        elif hasattr(message.media, 'webpage') and message.media.webpage:
            webpage = message.media.webpage
            if hasattr(webpage, 'url'):
                media_details["url"] = webpage.url
            if hasattr(webpage, 'title'):
                media_details["title"] = webpage.title
            if hasattr(webpage, 'description'):
                media_details["description"] = webpage.description
        
        # Handle contacts
        elif hasattr(message.media, 'phone_number'):
            media_details["phone_number"] = message.media.phone_number
            if hasattr(message.media, 'first_name'):
                media_details["first_name"] = message.media.first_name
            if hasattr(message.media, 'last_name'):
                media_details["last_name"] = message.media.last_name
        
        # Handle polls
        elif hasattr(message.media, 'poll') and message.media.poll:
            poll = message.media.poll
            if hasattr(poll, 'question'):
                media_details["question"] = poll.question
            if hasattr(poll, 'answers'):
                media_details["answers"] = [
                    {"text": ans.text, "option": ans.option.hex() if hasattr(ans.option, 'hex') else str(ans.option)}
                    for ans in poll.answers
                ]
        
        # Add resource URI for downloading
        media_details["resource_uri"] = f"tgfile://{utils.get_peer_id(message.peer_id)}/{message.id}"
        
        result["media"] = media_details

    return result

def get_entity_kind(entity) -> str:
    """Return a concise kind for an entity: user | group. Broadcast channels are excluded."""
    if isinstance(entity, User):
        return "user"
    if isinstance(entity, Channel):
        if getattr(entity, "megagroup", False):
            return "group"
        # Broadcast channels are not supported - return None to exclude them
        return None
    if isinstance(entity, Chat):
        return "group"
    return type(entity).__name__.lower()

def truncate(text: Optional[str], max_len: int = 100) -> str:
    """Return text truncated to max_len with ellipsis."""
    if not text:
        return ""
    return text if len(text) <= max_len else text[: max_len - 3] + "..."

def format_dialog_summary(dialog) -> Dict[str, Any]:
    """Compact summary for a Telethon dialog suitable for JSON returns."""
    entity = dialog.entity
    name = getattr(entity, "title", None) or getattr(entity, "first_name", "Unknown")
    if hasattr(entity, "last_name") and getattr(entity, "last_name", None):
        name = f"{name} {entity.last_name}"
    summary = {
        "id": entity.id,
        "name": name,
        "kind": get_entity_kind(entity),
        "unread": getattr(dialog, "unread_count", 0) or 0,
    }
    if getattr(dialog, "message", None):
        last = dialog.message
        summary["last_message"] = {
            "id": last.id,
            "date": last.date.isoformat() if getattr(last, "date", None) else None,
            "out": bool(getattr(last, "out", False)),
            "text_excerpt": truncate(getattr(last, "message", ""), 120),
        }
    return summary

def get_sender_name(message) -> str:
    """Helper function to get sender name from a message."""
    if not message.sender:
        return "Unknown"

    # Check for group/channel title first
    if hasattr(message.sender, "title") and message.sender.title:
        return message.sender.title
    elif hasattr(message.sender, "first_name"):
        # User sender
        first_name = getattr(message.sender, "first_name", "") or ""
        last_name = getattr(message.sender, "last_name", "") or ""
        full_name = f"{first_name} {last_name}".strip()
        return full_name if full_name else "Unknown"
    else:
        return "Unknown"


def format_message_display(message, chat_id: int) -> str:
    """
    Format message display including media information and resource URIs.
    
    Args:
        message: Telegram message object
        chat_id: Chat ID for resource URI generation
        
    Returns:
        Formatted string with text and media info
    """
    text_content = message.message or ""
    media_info = ""
    
    if message.media:
        media_type = type(message.media).__name__
        
        # Map Telegram media types to user-friendly names
        media_type_map = {
            "MessageMediaPhoto": "Photo",
            "MessageMediaDocument": "Document",
            "MessageMediaVideo": "Video", 
            "MessageMediaAudio": "Audio",
            "MessageMediaVoice": "Voice",
            "MessageMediaSticker": "Sticker",
            "MessageMediaGif": "GIF",
            "MessageMediaContact": "Contact",
            "MessageMediaGeo": "Location",
            "MessageMediaVenue": "Venue",
            "MessageMediaPoll": "Poll",
            "MessageMediaGame": "Game",
            "MessageMediaInvoice": "Invoice",
            "MessageMediaWebPage": "Web Page"
        }
        
        friendly_type = media_type_map.get(media_type, media_type)
        
        # Try to get filename for documents
        filename = ""
        if media_type == "MessageMediaDocument" and hasattr(message.media, "document"):
            doc = message.media.document
            if hasattr(doc, "attributes"):
                for attr in doc.attributes:
                    if hasattr(attr, "file_name") and attr.file_name:
                        filename = f": {attr.file_name}"
                        break
        
        media_info = f"[{friendly_type}{filename}]"
        
        # Add resource URI for accessing the media
        resource_uri = f"telegram://media/{chat_id}/{message.id}"
        media_info += f" (Resource: {resource_uri})"
    
    # Combine text and media info
    if text_content and media_info:
        return f"{media_info} {text_content}"
    elif media_info:
        return media_info
    elif text_content:
        return text_content
    else:
        return "[Empty message]"
