"""
Telegram MCP Tools - Misc Functions
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
from ..utils.helpers import format_entity, format_message, get_sender_name, json_serializer, get_entity_with_fallback
from ..utils.errors import log_and_format_error, ErrorCategory

# Import configuration
from ..config import client, logger

# Get logger
logger = logging.getLogger("telegram_mcp")


async def telegram_list_topics(
    chat_id: int,
    limit: int = 200,
    offset_topic: int = 0,
    search_query: str = None,
) -> str:
    """
    Retrieve forum topics from a group with the forum feature enabled.

    Note for LLM: You can send a message to a selected topic via reply_to_message tool
    by using Topic ID as the message_id parameter.

    Args:
        chat_id: The ID of the forum-enabled chat (group).
        limit: Maximum number of topics to retrieve.
        offset_topic: Topic ID offset for pagination.
        search_query: Optional query to filter topics by title.
    """
    try:
        entity = await get_entity_with_fallback(client, chat_id)

        if not isinstance(entity, Channel) or not getattr(entity, "megagroup", False):
            return "The specified chat is not a group."

        if not getattr(entity, "forum", False):
            return "The specified group does not have forum topics enabled."

        result = await client(
            functions.channels.GetForumTopicsRequest(
                channel=entity,
                offset_date=0,
                offset_id=0,
                offset_topic=offset_topic,
                limit=limit,
                q=search_query or None,
            )
        )

        topics = getattr(result, "topics", None) or []
        if not topics:
            return "No topics found for this chat."

        messages_map = {}
        if getattr(result, "messages", None):
            messages_map = {message.id: message for message in result.messages}

        lines = []
        for topic in topics:
            line_parts = [f"Topic ID: {topic.id}"]

            title = getattr(topic, "title", None) or "(no title)"
            line_parts.append(f"Title: {title}")

            total_messages = getattr(topic, "total_messages", None)
            if total_messages is not None:
                line_parts.append(f"Messages: {total_messages}")

            unread_count = getattr(topic, "unread_count", None)
            if unread_count:
                line_parts.append(f"Unread: {unread_count}")

            if getattr(topic, "closed", False):
                line_parts.append("Closed: Yes")

            if getattr(topic, "hidden", False):
                line_parts.append("Hidden: Yes")

            top_message_id = getattr(topic, "top_message", None)
            top_message = messages_map.get(top_message_id)
            if top_message and getattr(top_message, "date", None):
                line_parts.append(f"Last Activity: {top_message.date.isoformat()}")

            lines.append(" | ".join(line_parts))

        return "\n".join(lines)
    except Exception as e:
        return log_and_format_error(
            "list_topics",
            e,
            chat_id=chat_id,
            limit=limit,
            offset_topic=offset_topic,
            search_query=search_query,
        )




async def telegram_search_public_chats(query: str) -> str:
    """
    Search for public chats, channels, or bots by username or title.
    
    This is a GLOBAL search across all public Telegram content.
    Only use this tool when specifically asked to search for global or public chats.
    Do not use for searching within user's personal chats or conversations.
    """
    try:
        result = await client(functions.contacts.SearchRequest(q=query, limit=20))
        return json.dumps([format_entity(u) for u in result.users], indent=2)
    except Exception as e:
        return log_and_format_error("telegram_search_public_chats", e, query=query)




async def telegram_resolve_username(username: str) -> str:
    """
    Resolve a username to a user or chat ID.
    """
    try:
        result = await client(functions.contacts.ResolveUsernameRequest(username=username))
        return str(result)
    except Exception as e:
        return log_and_format_error("telegram_resolve_username", e, username=username)




async def telegram_mute_chat(chat_id: int) -> str:
    """
    Mute notifications for a chat.
    """
    try:
        from telethon.tl.types import InputPeerNotifySettings

        peer = await get_entity_with_fallback(client, chat_id)
        await client(
            functions.account.UpdateNotifySettingsRequest(
                peer=peer, settings=InputPeerNotifySettings(mute_until=2**31 - 1)
            )
        )
        return f"Chat {chat_id} muted."
    except (ImportError, AttributeError) as type_err:
        try:
            # Alternative approach directly using raw API
            peer = await client.get_input_entity(chat_id)
            await client(
                functions.account.UpdateNotifySettingsRequest(
                    peer=peer,
                    settings={
                        "mute_until": 2**31 - 1,  # Far future
                        "show_previews": False,
                        "silent": True,
                    },
                )
            )
            return f"Chat {chat_id} muted (using alternative method)."
        except Exception as alt_e:
            logger.exception(f"telegram_mute_chat (alt method) failed (chat_id={chat_id})")
            return log_and_format_error("telegram_mute_chat", alt_e, chat_id=chat_id)
    except Exception as e:
        logger.exception(f"telegram_mute_chat failed (chat_id={chat_id})")
        return log_and_format_error("telegram_mute_chat", e, chat_id=chat_id)




async def telegram_unmute_chat(chat_id: int) -> str:
    """
    Unmute notifications for a chat.
    """
    try:
        from telethon.tl.types import InputPeerNotifySettings

        peer = await get_entity_with_fallback(client, chat_id)
        await client(
            functions.account.UpdateNotifySettingsRequest(
                peer=peer, settings=InputPeerNotifySettings(mute_until=0)
            )
        )
        return f"Chat {chat_id} unmuted."
    except (ImportError, AttributeError) as type_err:
        try:
            # Alternative approach directly using raw API
            peer = await client.get_input_entity(chat_id)
            await client(
                functions.account.UpdateNotifySettingsRequest(
                    peer=peer,
                    settings={
                        "mute_until": 0,  # Unmute (current time)
                        "show_previews": True,
                        "silent": False,
                    },
                )
            )
            return f"Chat {chat_id} unmuted (using alternative method)."
        except Exception as alt_e:
            logger.exception(f"telegram_unmute_chat (alt method) failed (chat_id={chat_id})")
            return log_and_format_error("telegram_unmute_chat", alt_e, chat_id=chat_id)
    except Exception as e:
        logger.exception(f"telegram_unmute_chat failed (chat_id={chat_id})")
        return log_and_format_error("telegram_unmute_chat", e, chat_id=chat_id)




async def telegram_get_bot_info(bot_username: str) -> str:
    """
    Get information about a bot by username.
    """
    try:
        entity = await get_entity_with_fallback(client, bot_username)
        if not entity:
            return f"Bot with username {bot_username} not found."

        result = await client(functions.users.GetFullUserRequest(id=entity))

        # Create a more structured, serializable response
        if hasattr(result, "to_dict"):
            # Use custom serializer to handle non-serializable types
            return json.dumps(result.to_dict(), indent=2, default=json_serializer)
        else:
            # Fallback if to_dict is not available
            info = {
                "bot_info": {
                    "id": entity.id,
                    "username": entity.username,
                    "first_name": entity.first_name,
                    "last_name": getattr(entity, "last_name", ""),
                    "is_bot": getattr(entity, "bot", False),
                    "verified": getattr(entity, "verified", False),
                }
            }
            if hasattr(result, "full_user") and hasattr(result.full_user, "about"):
                info["bot_info"]["about"] = result.full_user.about

            return json.dumps(info, indent=2)
    except Exception as e:
        logger.exception(f"telegram_get_bot_info failed (bot_username={bot_username})")
        return log_and_format_error("telegram_get_bot_info", e, bot_username=bot_username)




async def telegram_set_bot_commands(bot_username: str, commands: list) -> str:
    """
    Set bot commands for a bot you own.
    Note: This function can only be used if the Telegram client is a bot account.
    Regular user accounts cannot set bot commands.

    Args:
        bot_username: The username of the bot to set commands for.
        commands: List of command dictionaries with 'command' and 'description' keys.
    """
    try:
        # First check if the current client is a bot
        me = await client.get_me()
        if not getattr(me, "bot", False):
            return "Error: This function can only be used by bot accounts. Your current Telegram account is a regular user account, not a bot."

        # Import required types
        from telethon.tl.types import BotCommand, BotCommandScopeDefault
        from telethon.tl.functions.bots import SetBotCommandsRequest

        # Create BotCommand objects from the command dictionaries
        bot_commands = [
            BotCommand(command=c["command"], description=c["description"]) for c in commands
        ]

        # Get the bot entity
        bot = await get_entity_with_fallback(client, bot_username)

        # Set the commands with proper scope
        await client(
            SetBotCommandsRequest(
                scope=BotCommandScopeDefault(),
                lang_code="en",  # Default language code
                commands=bot_commands,
            )
        )

        return f"Bot commands set for {bot_username}."
    except ImportError as ie:
        logger.exception(f"telegram_set_bot_commands failed - ImportError: {ie}")
        return log_and_format_error("telegram_set_bot_commands", ie)
    except Exception as e:
        logger.exception(f"telegram_set_bot_commands failed (bot_username={bot_username})")
        return log_and_format_error("telegram_set_bot_commands", e, bot_username=bot_username)



