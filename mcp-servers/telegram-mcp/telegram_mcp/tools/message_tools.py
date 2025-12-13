"""
Telegram MCP Tools - Message Functions
Auto-generated from main.py refactoring
"""

from mcp.server.fastmcp import FastMCP
from telethon import TelegramClient, functions, utils
from telethon.tl.types import *
import telethon.errors.rpcerrorlist
import logging
import json
import os
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Union, Any

# Import shared utilities
from ..utils.helpers import format_entity, format_message, get_sender_name, json_serializer, format_message_display, get_entity_with_fallback
from ..utils.errors import log_and_format_error, ErrorCategory

# Import configuration
from ..config import client, logger

# Get logger
logger = logging.getLogger("telegram_mcp")


async def telegram_get_messages(chat_id: int, page: int = 1, page_size: int = 10) -> str:
    """Messages: List messages (paged) from a chat and return JSON."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)
        # enforce limits
        safe_page = max(1, int(page))
        safe_page_size = min(50, max(1, int(page_size)))
        offset = (safe_page - 1) * safe_page_size
        messages = await client.get_messages(entity, limit=safe_page_size, add_offset=offset)
        data = [format_message(m) for m in messages] if messages else []
        return json.dumps(data, default=json_serializer)
    except Exception as e:
        return log_and_format_error(
            "get_messages", e, chat_id=chat_id, page=page, page_size=page_size
        )




async def telegram_send_message(
    chat_id: Optional[int] = None, 
    message: Optional[str] = None,
    channelId: Optional[int] = None,
    content: Optional[str] = None
) -> str:
    """Messages: Send a message to a chat and return { ok, message }."""
    # Normalize parameter names: prioritize original names, fall back to alternatives
    actual_chat_id = chat_id if chat_id is not None else channelId
    actual_message = message if message is not None else content
    
    # Validate that we have both required parameters
    if actual_chat_id is None:
        return log_and_format_error("telegram_send_message", ValueError("Missing required parameter: chat_id or channelId"), chat_id=None)
    if actual_message is None:
        return log_and_format_error("telegram_send_message", ValueError("Missing required parameter: message or content"), chat_id=actual_chat_id)
    
    try:
        entity = await get_entity_with_fallback(client, actual_chat_id)
        await client.send_message(entity, actual_message)
        return json.dumps({"ok": True, "message": "Message sent."})
    except Exception as e:
        return log_and_format_error("telegram_send_message", e, chat_id=actual_chat_id)




async def telegram_list_messages(
    chat_id: int,
    limit: int = 10,
    search_query: str = None,
    from_date: str = None,
    to_date: str = None,
) -> str:
    """Messages: List messages with filters and return JSON (limit<=50)."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)

        # Parse date filters if provided
        from_date_obj = None
        to_date_obj = None

        if from_date:
            try:
                from_date_obj = datetime.strptime(from_date, "%Y-%m-%d")
                # Make it timezone aware by adding UTC timezone info
                # Use datetime.timezone.utc for Python 3.9+ or import timezone directly for 3.13+
                try:
                    # For Python 3.9+
                    from_date_obj = from_date_obj.replace(tzinfo=datetime.timezone.utc)
                except AttributeError:
                    # For Python 3.13+
                    from datetime import timezone

                    from_date_obj = from_date_obj.replace(tzinfo=timezone.utc)
            except ValueError:
                return "Error: Invalid from_date format. Use YYYY-MM-DD."

        if to_date:
            try:
                to_date_obj = datetime.strptime(to_date, "%Y-%m-%d")
                # Set to end of day and make timezone aware
                to_date_obj = to_date_obj + timedelta(days=1, microseconds=-1)
                # Add timezone info
                try:
                    to_date_obj = to_date_obj.replace(tzinfo=datetime.timezone.utc)
                except AttributeError:
                    from datetime import timezone

                    to_date_obj = to_date_obj.replace(tzinfo=timezone.utc)
            except ValueError:
                return "Error: Invalid to_date format. Use YYYY-MM-DD."

        # enforce safe limit
        safe_limit = min(50, max(1, int(limit)))

        # Prepare filter parameters
        params = {}
        if search_query:
            # IMPORTANT: Do not combine offset_date with search.
            # Use server-side search alone, then enforce date bounds client-side.
            params["search"] = search_query
            messages = []
            async for msg in client.iter_messages(entity, **params):  # newest -> oldest
                if to_date_obj and msg.date > to_date_obj:
                    continue
                if from_date_obj and msg.date < from_date_obj:
                    break
                messages.append(msg)
                if len(messages) >= safe_limit:
                    break

        else:
            # Use server-side iteration when only date bounds are present
            # (no search) to avoid over-fetching.
            if from_date_obj or to_date_obj:
                messages = []
                if from_date_obj:
                    # Walk forward from start date (oldest -> newest)
                    async for msg in client.iter_messages(
                        entity, offset_date=from_date_obj, reverse=True
                    ):
                        if to_date_obj and msg.date > to_date_obj:
                            break
                        if msg.date < from_date_obj:
                            continue
                        messages.append(msg)
                        if len(messages) >= safe_limit:
                            break
                else:
                    # Only upper bound: walk backward from end bound
                    async for msg in client.iter_messages(
                        # offset_date is exclusive; +1µs makes to_date inclusive
                        entity,
                        offset_date=to_date_obj + timedelta(microseconds=1),
                    ):
                        messages.append(msg)
                        if len(messages) >= safe_limit:
                            break
            else:
                messages = await client.get_messages(entity, limit=safe_limit, **params)

        data = [format_message(m) for m in messages] if messages else []
        return json.dumps(data, default=json_serializer)
    except Exception as e:
        return log_and_format_error("telegram_list_messages", e, chat_id=chat_id)




async def telegram_get_message_context(chat_id: int, message_id: int, context_size: int = 3) -> str:
    """Messages: Get message context around a message and return JSON."""
    try:
        chat = await get_entity_with_fallback(client, chat_id)
        # Get messages around the specified message
        messages_before = await client.get_messages(chat, limit=context_size, max_id=message_id)
        central_message = await client.get_messages(chat, ids=message_id)
        # Fix: get_messages(ids=...) returns a single Message, not a list
        if central_message is not None and not isinstance(central_message, list):
            central_message = [central_message]
        elif central_message is None:
            central_message = []
        messages_after = await client.get_messages(
            chat, limit=context_size, min_id=message_id, reverse=True
        )
        if not central_message:
            return f"Message with ID {message_id} not found in chat {chat_id}."
        # Combine messages in chronological order
        all_messages = list(messages_before) + list(central_message) + list(messages_after)
        all_messages.sort(key=lambda m: m.id)
        data = {
            "chat_id": chat_id,
            "message_id": message_id,
            "before": [format_message(m) for m in messages_before],
            "center": format_message(central_message[0]) if central_message else None,
            "after": [format_message(m) for m in messages_after],
        }
        return json.dumps(data, default=json_serializer)
    except Exception as e:
        return log_and_format_error(
            "get_message_context",
            e,
            chat_id=chat_id,
            message_id=message_id,
            context_size=context_size,
        )




async def telegram_forward_message(from_chat_id: int, message_id: int, to_chat_id: int) -> str:
    """Messages: Forward a message and return { ok, message }."""
    try:
        from_entity = await get_entity_with_fallback(client, from_chat_id)
        to_entity = await get_entity_with_fallback(client, to_chat_id)
        await client.forward_messages(to_entity, message_id, from_entity)
        return json.dumps({"ok": True, "message": f"Message {message_id} forwarded."})
    except Exception as e:
        return log_and_format_error(
            "forward_message",
            e,
            from_chat_id=from_chat_id,
            message_id=message_id,
            to_chat_id=to_chat_id,
        )




async def telegram_edit_message(chat_id: int, message_id: int, new_text: str) -> str:
    """Messages: Edit a message and return { ok, message }."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)
        await client.edit_message(entity, message_id, new_text)
        return json.dumps({"ok": True, "message": f"Message {message_id} edited."})
    except Exception as e:
        return log_and_format_error(
            "edit_message", e, chat_id=chat_id, message_id=message_id, new_text=new_text
        )




async def telegram_delete_message(chat_id: int, message_id: int) -> str:
    """Messages: Delete a message and return { ok, message }."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)
        await client.delete_messages(entity, message_id)
        return json.dumps({"ok": True, "message": f"Message {message_id} deleted."})
    except Exception as e:
        return log_and_format_error("telegram_delete_message", e, chat_id=chat_id, message_id=message_id)




async def telegram_pin_message(chat_id: int, message_id: int) -> str:
    """Messages: Pin a message and return { ok, message }."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)
        await client.pin_message(entity, message_id)
        return json.dumps({"ok": True, "message": f"Message {message_id} pinned."})
    except Exception as e:
        return log_and_format_error("telegram_pin_message", e, chat_id=chat_id, message_id=message_id)




async def telegram_unpin_message(chat_id: int, message_id: int) -> str:
    """Messages: Unpin a message and return { ok, message }."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)
        await client.unpin_message(entity, message_id)
        return json.dumps({"ok": True, "message": f"Message {message_id} unpinned."})
    except Exception as e:
        return log_and_format_error("telegram_unpin_message", e, chat_id=chat_id, message_id=message_id)




async def telegram_mark_as_read(chat_id: int) -> str:
    """Messages: Mark chat as read and return { ok, message }."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)
        await client.send_read_acknowledge(entity)
        return json.dumps({"ok": True, "message": f"Marked as read."})
    except Exception as e:
        return log_and_format_error("telegram_mark_as_read", e, chat_id=chat_id)




async def telegram_reply_to_message(chat_id: int, message_id: int, text: str) -> str:
    """Messages: Reply to a message and return { ok, message }."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)
        await client.send_message(entity, text, reply_to=message_id)
        return json.dumps({"ok": True, "message": f"Replied to message {message_id}."})
    except Exception as e:
        return log_and_format_error(
            "reply_to_message", e, chat_id=chat_id, message_id=message_id, text=text
        )




async def telegram_search_messages(chat_id: int, query: str, limit: int = 10) -> str:
    """Messages: Search messages by text and return JSON (limit<=50)."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)
        safe_limit = min(50, max(1, int(limit)))
        messages = await client.get_messages(entity, limit=safe_limit, search=query)
        data = [format_message(m) for m in messages] if messages else []
        return json.dumps(data, default=json_serializer)
    except Exception as e:
        return log_and_format_error(
            "search_messages", e, chat_id=chat_id, query=query, limit=limit
        )




async def telegram_get_history(chat_id: int, limit: int = 10) -> str:
    """Messages: Deprecated alias; use list_messages (returns JSON)."""
    try:
        # Delegate to list_messages with safe cap
        safe_limit = min(50, max(1, int(limit)))
        return await telegram_list_messages(chat_id=chat_id, limit=safe_limit)
    except Exception as e:
        return log_and_format_error("telegram_get_history", e, chat_id=chat_id, limit=limit)




async def telegram_get_pinned_messages(chat_id: int) -> str:
    """Messages: List pinned messages and return JSON."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)
        # Use correct filter based on Telethon version
        try:
            # Try newer Telethon approach
            from telethon.tl.types import InputMessagesFilterPinned

            messages = await client.get_messages(entity, filter=InputMessagesFilterPinned())
        except (ImportError, AttributeError):
            # Fallback - try without filter and manually filter pinned
            all_messages = await client.get_messages(entity, limit=50)
            messages = [m for m in all_messages if getattr(m, "pinned", False)]
        data = [format_message(m) for m in messages] if messages else []
        return json.dumps(data, default=json_serializer)
    except Exception as e:
        logger.exception(f"telegram_get_pinned_messages failed (chat_id={chat_id})")
        return log_and_format_error("telegram_get_pinned_messages", e, chat_id=chat_id)




async def telegram_create_poll(
    chat_id: int,
    question: str,
    options: list,
    multiple_choice: bool = False,
    quiz_mode: bool = False,
    public_votes: bool = True,
    close_date: str = None,
) -> str:
    """Messages: Create a poll in a chat and return { ok, message }."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)

        # Validate options
        if len(options) < 2:
            return "Error: Poll must have at least 2 options."
        if len(options) > 10:
            return "Error: Poll can have at most 10 options."

        # Parse close date if provided
        close_date_obj = None
        if close_date:
            try:
                close_date_obj = datetime.fromisoformat(close_date.replace("Z", "+00:00"))
            except ValueError:
                return f"Invalid close_date format. Use YYYY-MM-DD HH:MM:SS format."

        # Create the poll using InputMediaPoll with SendMediaRequest
        from telethon.tl.types import InputMediaPoll, Poll, PollAnswer, TextWithEntities
        import random

        poll = Poll(
            id=random.randint(0, 2**63 - 1),
            question=TextWithEntities(text=question, entities=[]),
            answers=[
                PollAnswer(text=TextWithEntities(text=option, entities=[]), option=bytes([i]))
                for i, option in enumerate(options)
            ],
            multiple_choice=multiple_choice,
            quiz=quiz_mode,
            public_voters=public_votes,
            close_date=close_date_obj,
        )

        result = await client(
            functions.messages.SendMediaRequest(
                peer=entity,
                media=InputMediaPoll(poll=poll),
                message="",
                random_id=random.randint(0, 2**63 - 1),
            )
        )

        return json.dumps({"ok": True, "message": "Poll created."})
    except Exception as e:
        logger.exception(f"telegram_create_poll failed (chat_id={chat_id}, question='{question}')")
        return log_and_format_error(
            "create_poll", e, chat_id=chat_id, question=question, options=options
        )



