"""
Telegram MCP Tools - Reaction Functions
"""

from telethon import functions
from telethon.tl.types import *
import logging
import json
from typing import Optional

# Shared utilities
from ..utils.helpers import format_entity, json_serializer, get_entity_with_fallback
from ..utils.errors import log_and_format_error

# Configuration
from ..config import client, logger

logger = logging.getLogger("telegram_mcp")


async def telegram_react_to_message(chat_id: int, message_id: int, emoji: str, big: bool = False) -> str:
    """
    Add a reaction to a message using a Unicode emoji.
    """
    try:
        entity = await get_entity_with_fallback(client, chat_id)

        # Prefer ReactionEmoji if available; otherwise fall back to raw string
        try:
            reaction = [ReactionEmoji(emoticon=emoji)]
        except Exception:
            # Some Telethon versions may still accept strings
            reaction = [emoji]

        await client(
            functions.messages.SendReactionRequest(
                peer=entity,
                msg_id=message_id,
                reaction=reaction,
                big=big,
            )
        )
        return f"Reacted to message {message_id} in chat {chat_id} with {emoji}."
    except Exception as e:
        return log_and_format_error(
            "react_to_message", e, chat_id=chat_id, message_id=message_id, emoji=emoji, big=big
        )


async def telegram_unreact_message(chat_id: int, message_id: int) -> str:
    """
    Remove your own reaction(s) from a message.
    """
    try:
        entity = await get_entity_with_fallback(client, chat_id)
        await client(
            functions.messages.SendReactionRequest(
                peer=entity,
                msg_id=message_id,
                reaction=[],
                add_to_recent=False,
            )
        )
        return f"Removed reaction from message {message_id} in chat {chat_id}."
    except Exception as e:
        return log_and_format_error("telegram_unreact_message", e, chat_id=chat_id, message_id=message_id)


async def telegram_get_message_reactions(chat_id: int, message_id: int) -> str:
    """
    Get aggregated reaction counters for a message as JSON.
    """
    try:
        entity = await get_entity_with_fallback(client, chat_id)

        # Try modern API first
        result = await client(
            functions.messages.GetMessagesReactionsRequest(peer=entity, id=[message_id])
        )

        summary = {
            "chat_id": chat_id,
            "message_id": message_id,
            "reactions": [],
        }

        # results.results is a list aligned with provided ids
        if getattr(result, "results", None):
            message_result = result.results[0]
            counters = getattr(message_result, "results", None) or []
            for counter in counters:
                # counter.reaction could be ReactionEmoji or ReactionCustomEmoji
                emoji_value = None
                if hasattr(counter.reaction, "emoticon"):
                    emoji_value = counter.reaction.emoticon
                elif hasattr(counter.reaction, "document_id"):
                    emoji_value = f"custom:{counter.reaction.document_id}"
                else:
                    emoji_value = str(counter.reaction)

                summary["reactions"].append(
                    {
                        "reaction": emoji_value,
                        "count": getattr(counter, "count", 0),
                        "chosen": getattr(counter, "chosen_order", None) is not None,
                    }
                )

        return json.dumps(summary, indent=2, default=json_serializer)
    except Exception as e:
        return log_and_format_error(
            "get_message_reactions", e, chat_id=chat_id, message_id=message_id
        )


async def telegram_get_reactors(
    chat_id: int,
    message_id: int,
    emoji: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> str:
    """
    List users who reacted to a message. Optionally filter by emoji.
    """
    try:
        entity = await get_entity_with_fallback(client, chat_id)

        reaction_filter = None
        if emoji:
            try:
                reaction_filter = ReactionEmoji(emoticon=emoji)
            except Exception:
                reaction_filter = None

        result = await client(
            functions.messages.GetMessageReactionsListRequest(
                peer=entity,
                id=message_id,
                reaction=reaction_filter,
                limit=limit,
                offset=offset,
            )
        )

        users = getattr(result, "users", [])
        formatted = [format_entity(u) for u in users]
        payload = {
            "chat_id": chat_id,
            "message_id": message_id,
            "emoji": emoji,
            "count": len(formatted),
            "users": formatted,
        }
        return json.dumps(payload, indent=2, default=json_serializer)
    except Exception as e:
        return log_and_format_error(
            "get_reactors",
            e,
            chat_id=chat_id,
            message_id=message_id,
            emoji=emoji,
            limit=limit,
            offset=offset,
        )


