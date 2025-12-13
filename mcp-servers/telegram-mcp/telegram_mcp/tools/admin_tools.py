"""
Telegram MCP Tools - Admin Functions
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


async def telegram_invite_to_group(chat_id: int, user_ids: list[int]) -> dict:
    """Admin: Invite users to a chat by id."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)
        users_to_add = []

        for user_id in user_ids:
            try:
                user = await get_entity_with_fallback(client, user_id)
                users_to_add.append(user)
            except ValueError as e:
                return {"ok": False, "message": f"Error: User {user_id} not found. {e}"}

        try:
            result = await client(
                functions.channels.InviteToChannelRequest(channel=entity, users=users_to_add)
            )

            invited_count = 0
            if hasattr(result, "users") and result.users:
                invited_count = len(result.users)
            elif hasattr(result, "count"):
                invited_count = result.count

            return {"ok": True, "message": f"Invited {invited_count} users to {getattr(entity, 'title', 'chat')}"}
        except telethon.errors.rpcerrorlist.UserNotMutualContactError:
            return {"ok": False, "message": "Error: User not mutual contact; cannot invite."}
        except telethon.errors.rpcerrorlist.UserPrivacyRestrictedError:
            return {"ok": False, "message": "Error: User privacy restricts adding to chat."}
        except Exception as e:
            return {"ok": False, "message": log_and_format_error("telegram_invite_to_group", e, chat_id=chat_id, user_ids=user_ids)}

    except Exception as e:
        logger.error(
            f"telegram_mcp telegram_invite_to_group failed (chat_id={chat_id}, user_ids={user_ids})",
            exc_info=True,
        )
        return {"ok": False, "message": log_and_format_error("telegram_invite_to_group", e, chat_id=chat_id, user_ids=user_ids)}




async def telegram_get_participants(chat_id: int, limit: int = 10, offset: int = 0) -> list[dict]:
    """Admin: List chat participants as JSON (paginated)."""
    try:
        capped_limit = max(1, min(limit, 50))
        start = max(0, int(offset or 0))
        fetch_count = start + capped_limit
        # Telethon versions may not accept 'offset'; emulate by over-fetching then slicing
        participants = await client.get_participants(chat_id, limit=fetch_count)
        sliced = participants[start : start + capped_limit]
        return [format_entity(p) for p in sliced]
    except Exception as e:
        return {"error": log_and_format_error("telegram_get_participants", e, chat_id=chat_id)}




async def telegram_promote_admin(chat_id: int, user_id: int, rights: dict | None = None) -> dict:
    """Admin: Promote a user to admin."""
    try:
        chat = await get_entity_with_fallback(client, chat_id)
        user = await get_entity_with_fallback(client, user_id)

        # Set default admin rights if not provided
        if not rights:
            rights = {
                "change_info": True,
                "post_messages": True,
                "edit_messages": True,
                "delete_messages": True,
                "ban_users": True,
                "invite_users": True,
                "pin_messages": True,
                "add_admins": False,
                "anonymous": False,
                "manage_call": True,
                "other": True,
            }

        admin_rights = ChatAdminRights(
            change_info=rights.get("change_info", True),
            post_messages=rights.get("post_messages", True),
            edit_messages=rights.get("edit_messages", True),
            delete_messages=rights.get("delete_messages", True),
            ban_users=rights.get("ban_users", True),
            invite_users=rights.get("invite_users", True),
            pin_messages=rights.get("pin_messages", True),
            add_admins=rights.get("add_admins", False),
            anonymous=rights.get("anonymous", False),
            manage_call=rights.get("manage_call", True),
            other=rights.get("other", True),
        )

        try:
            result = await client(
                functions.channels.EditAdminRequest(
                    channel=chat, user_id=user, admin_rights=admin_rights, rank="Admin"
                )
            )
            return {"ok": True, "message": f"Promoted {user_id} to admin in {getattr(chat, 'title', 'chat')}"}
        except telethon.errors.rpcerrorlist.UserNotMutualContactError:
            return {"ok": False, "message": "Error: User not mutual contact; cannot promote."}
        except Exception as e:
            return {"ok": False, "message": log_and_format_error("telegram_promote_admin", e, chat_id=chat_id, user_id=user_id)}

    except Exception as e:
        logger.error(
            f"telegram_mcp telegram_promote_admin failed (chat_id={chat_id}, user_id={user_id})",
            exc_info=True,
        )
        return {"ok": False, "message": log_and_format_error("telegram_promote_admin", e, chat_id=chat_id, user_id=user_id)}




async def telegram_demote_admin(chat_id: int, user_id: int) -> dict:
    """Admin: Demote a user from admin."""
    try:
        chat = await get_entity_with_fallback(client, chat_id)
        user = await get_entity_with_fallback(client, user_id)

        # Create empty admin rights (regular user)
        admin_rights = ChatAdminRights(
            change_info=False,
            post_messages=False,
            edit_messages=False,
            delete_messages=False,
            ban_users=False,
            invite_users=False,
            pin_messages=False,
            add_admins=False,
            anonymous=False,
            manage_call=False,
            other=False,
        )

        try:
            result = await client(
                functions.channels.EditAdminRequest(
                    channel=chat, user_id=user, admin_rights=admin_rights, rank=""
                )
            )
            return {"ok": True, "message": f"Demoted {user_id} from admin in {getattr(chat, 'title', 'chat')}"}
        except telethon.errors.rpcerrorlist.UserNotMutualContactError:
            return {"ok": False, "message": "Error: User not mutual contact; cannot change admin."}
        except Exception as e:
            return {"ok": False, "message": log_and_format_error("telegram_demote_admin", e, chat_id=chat_id, user_id=user_id)}

    except Exception as e:
        logger.error(
            f"telegram_mcp telegram_demote_admin failed (chat_id={chat_id}, user_id={user_id})",
            exc_info=True,
        )
        return {"ok": False, "message": log_and_format_error("telegram_demote_admin", e, chat_id=chat_id, user_id=user_id)}




async def telegram_ban_user(chat_id: int, user_id: int) -> dict:
    """Admin: Ban a user from a chat."""
    try:
        chat = await get_entity_with_fallback(client, chat_id)
        user = await get_entity_with_fallback(client, user_id)

        # Create banned rights (all restrictions enabled)
        banned_rights = ChatBannedRights(
            until_date=None,  # Ban forever
            view_messages=True,
            send_messages=True,
            send_media=True,
            send_stickers=True,
            send_gifs=True,
            send_games=True,
            send_inline=True,
            embed_links=True,
            send_polls=True,
            change_info=True,
            invite_users=True,
            pin_messages=True,
        )

        try:
            await client(
                functions.channels.EditBannedRequest(
                    channel=chat, participant=user, banned_rights=banned_rights
                )
            )
            return {"ok": True, "message": f"Banned {user_id} from {getattr(chat, 'title', 'chat')}."}
        except telethon.errors.rpcerrorlist.UserNotMutualContactError:
            return {"ok": False, "message": "Error: User not mutual contact; cannot ban."}
        except Exception as e:
            return {"ok": False, "message": log_and_format_error("telegram_ban_user", e, chat_id=chat_id, user_id=user_id)}
    except Exception as e:
        logger.exception(f"telegram_ban_user failed (chat_id={chat_id}, user_id={user_id})")
        return {"ok": False, "message": log_and_format_error("telegram_ban_user", e, chat_id=chat_id, user_id=user_id)}




async def telegram_unban_user(chat_id: int, user_id: int) -> dict:
    """Admin: Unban a user from a chat."""
    try:
        chat = await get_entity_with_fallback(client, chat_id)
        user = await get_entity_with_fallback(client, user_id)

        # Create unbanned rights (no restrictions)
        unbanned_rights = ChatBannedRights(
            until_date=None,
            view_messages=False,
            send_messages=False,
            send_media=False,
            send_stickers=False,
            send_gifs=False,
            send_games=False,
            send_inline=False,
            embed_links=False,
            send_polls=False,
            change_info=False,
            invite_users=False,
            pin_messages=False,
        )

        try:
            await client(
                functions.channels.EditBannedRequest(
                    channel=chat, participant=user, banned_rights=unbanned_rights
                )
            )
            return {"ok": True, "message": f"Unbanned {user_id} in {getattr(chat, 'title', 'chat')}."}
        except telethon.errors.rpcerrorlist.UserNotMutualContactError:
            return {"ok": False, "message": "Error: User not mutual contact; cannot unban."}
        except Exception as e:
            return {"ok": False, "message": log_and_format_error("telegram_unban_user", e, chat_id=chat_id, user_id=user_id)}
    except Exception as e:
        logger.exception(f"telegram_unban_user failed (chat_id={chat_id}, user_id={user_id})")
        return {"ok": False, "message": log_and_format_error("telegram_unban_user", e, chat_id=chat_id, user_id=user_id)}




async def telegram_get_admins(chat_id: int, limit: int = 10, offset: int = 0) -> list[dict]:
    """Admin: List admins as JSON (paginated)."""
    try:
        capped_limit = max(1, min(limit, 50))
        start = max(0, int(offset or 0))
        fetch_count = start + capped_limit
        participants = await client.get_participants(
            chat_id, filter=ChannelParticipantsAdmins(), limit=fetch_count
        )
        sliced = participants[start : start + capped_limit]
        return [format_entity(p) for p in sliced]
    except Exception as e:
        logger.exception(f"telegram_get_admins failed (chat_id={chat_id})")
        return {"error": log_and_format_error("telegram_get_admins", e, chat_id=chat_id)}




async def telegram_get_banned_users(chat_id: int, limit: int = 10, offset: int = 0) -> list[dict]:
    """Admin: List banned users as JSON (paginated)."""
    try:
        capped_limit = max(1, min(limit, 50))
        start = max(0, int(offset or 0))
        fetch_count = start + capped_limit
        participants = await client.get_participants(
            chat_id, filter=ChannelParticipantsKicked(q=""), limit=fetch_count
        )
        sliced = participants[start : start + capped_limit]
        return [format_entity(p) for p in sliced]
    except Exception as e:
        logger.exception(f"telegram_get_banned_users failed (chat_id={chat_id})")
        return {"error": log_and_format_error("telegram_get_banned_users", e, chat_id=chat_id)}




async def telegram_get_recent_actions(chat_id: int, limit: int = 10) -> list[dict]:
    """Admin: List recent admin actions (paginated)."""
    try:
        capped_limit = max(1, min(limit, 50))
        result = await client(
            functions.channels.GetAdminLogRequest(
                channel=chat_id, q="", events_filter=None, admins=[], max_id=0, min_id=0, limit=capped_limit
            )
        )

        if not result or not result.events:
            return []

        # Use the custom serializer to handle datetime objects; compact each event
        events = []
        for e in result.events:
            ed = e.to_dict()
            events.append({
                "id": ed.get("id"),
                "date": ed.get("date").isoformat() if ed.get("date") else None,
                "action": ed.get("action", {}).get("_"),
                "user_id": ed.get("user_id"),
            })
        return events
    except Exception as e:
        logger.exception(f"telegram_get_recent_actions failed (chat_id={chat_id})")
        return {"error": log_and_format_error("telegram_get_recent_actions", e, chat_id=chat_id)}



