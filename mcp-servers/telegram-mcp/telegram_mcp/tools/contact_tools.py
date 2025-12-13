"""
Telegram MCP Tools - Contact Functions
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


async def telegram_list_contacts(limit: int = 10, offset: int = 0) -> dict:
    """Contacts: List contacts as compact JSON with pagination (limit≤200)."""
    try:
        safe_limit = max(0, min(int(limit), 200)) or 10
        safe_offset = max(0, int(offset))

        result = await client(functions.contacts.GetContactsRequest(hash=0))
        users = result.users or []

        sliced = users[safe_offset : safe_offset + safe_limit]
        return {
            "ok": True,
            "total": len(users),
            "limit": safe_limit,
            "offset": safe_offset,
            "contacts": [format_entity(u) for u in sliced],
        }
    except Exception as e:
        return {"ok": False, "error": log_and_format_error("telegram_list_contacts", e)}




async def telegram_search_contacts(query: str, limit: int = 10, offset: int = 0) -> dict:
    """Contacts: Search contacts by name/username/phone (limit≤200)."""
    try:
        safe_limit = max(0, min(int(limit), 200)) or 10
        safe_offset = max(0, int(offset))

        # Telethon's search has limit but no offset; fetch up to offset+limit then slice
        fetch_count = min(200, safe_offset + safe_limit) or 10
        result = await client(functions.contacts.SearchRequest(q=query, limit=fetch_count))
        users = result.users or []
        sliced = users[safe_offset : safe_offset + safe_limit]
        return {
            "ok": True,
            "total": len(users),
            "limit": safe_limit,
            "offset": safe_offset,
            "contacts": [format_entity(u) for u in sliced],
        }
    except Exception as e:
        return {"ok": False, "error": log_and_format_error("telegram_search_contacts", e, query=query)}




async def telegram_get_contact_ids() -> dict:
    """Contacts: Deprecated. Use list_contacts and read id fields."""
    try:
        result = await client(functions.contacts.GetContactIDsRequest(hash=0))
        ids = list(result or [])
        return {"ok": True, "ids": ids}
    except Exception as e:
        return {"ok": False, "error": log_and_format_error("telegram_get_contact_ids", e)}




async def telegram_get_last_interaction(user_id: int, limit: int = 5) -> dict:
    """Contacts: Get recent messages with a user as JSON (limit≤200)."""
    try:
        # Get contact info
        contact = await get_entity_with_fallback(client, user_id)
        if not isinstance(contact, User):
            return {"ok": False, "error": f"Error: ID {user_id} is not a user"}

        safe_limit = max(1, min(int(limit), 200))

        # Get recent messages
        messages = await client.get_messages(contact, limit=safe_limit)

        return {
            "ok": True,
            "user": format_entity(contact),
            "messages": [format_message(m) for m in messages or []],
        }
    except Exception as e:
        return {"ok": False, "error": log_and_format_error("telegram_get_last_interaction", e, user_id=user_id)}




async def telegram_add_contact(phone: str, first_name: str, last_name: str = "") -> dict:
    """Contacts: Add a contact by phone and name."""
    try:
        # Try to import the required types first
        from telethon.tl.types import InputPhoneContact

        result = await client(
            functions.contacts.ImportContactsRequest(
                contacts=[
                    InputPhoneContact(
                        client_id=0, phone=phone, first_name=first_name, last_name=last_name
                    )
                ]
            )
        )
        if result.imported:
            return {"ok": True, "message": f"Contact {first_name} {last_name} added"}
        else:
            return {"ok": False, "error": "Error: Contact not added"}
    except (ImportError, AttributeError) as type_err:
        # Try alternative approach using raw API
        try:
            result = await client(
                functions.contacts.ImportContactsRequest(
                    contacts=[
                        {
                            "client_id": 0,
                            "phone": phone,
                            "first_name": first_name,
                            "last_name": last_name,
                        }
                    ]
                )
            )
            if hasattr(result, "imported") and result.imported:
                return {"ok": True, "message": f"Contact {first_name} {last_name} added"}
            else:
                return {"ok": False, "error": "Error: Contact not added"}
        except Exception as alt_e:
            logger.exception(f"telegram_add_contact (alt method) failed (phone={phone})")
            return {"ok": False, "error": log_and_format_error("telegram_add_contact", alt_e, phone=phone)}
    except Exception as e:
        logger.exception(f"telegram_add_contact failed (phone={phone})")
        return {"ok": False, "error": log_and_format_error("telegram_add_contact", e, phone=phone)}




async def telegram_delete_contact(user_id: int) -> dict:
    """Contacts: Delete a contact by user_id."""
    try:
        user = await get_entity_with_fallback(client, user_id)
        await client(functions.contacts.DeleteContactsRequest(id=[user]))
        return {"ok": True, "message": f"Deleted contact {user_id}"}
    except Exception as e:
        return {"ok": False, "error": log_and_format_error("telegram_delete_contact", e, user_id=user_id)}




async def telegram_block_user(user_id: int) -> dict:
    """Contacts: Block a user by user_id."""
    try:
        user = await get_entity_with_fallback(client, user_id)
        await client(functions.contacts.BlockRequest(id=user))
        return {"ok": True, "message": f"Blocked user {user_id}"}
    except Exception as e:
        return {"ok": False, "error": log_and_format_error("telegram_block_user", e, user_id=user_id)}




async def telegram_unblock_user(user_id: int) -> dict:
    """Contacts: Unblock a user by user_id."""
    try:
        user = await get_entity_with_fallback(client, user_id)
        await client(functions.contacts.UnblockRequest(id=user))
        return {"ok": True, "message": f"Unblocked user {user_id}"}
    except Exception as e:
        return {"ok": False, "error": log_and_format_error("telegram_unblock_user", e, user_id=user_id)}




async def telegram_import_contacts(contacts: list) -> dict:
    """Contacts: Import contacts from a list of {phone, first_name, last_name}."""
    try:
        input_contacts = [
            functions.contacts.InputPhoneContact(
                client_id=i,
                phone=c["phone"],
                first_name=c["first_name"],
                last_name=c.get("last_name", ""),
            )
            for i, c in enumerate(contacts)
        ]
        result = await client(functions.contacts.ImportContactsRequest(contacts=input_contacts))
        count = len(getattr(result, "imported", []) or [])
        return {"ok": True, "message": f"Imported {count} contacts"}
    except Exception as e:
        return {"ok": False, "error": log_and_format_error("telegram_import_contacts", e, contacts=contacts)}




async def telegram_export_contacts(limit: int = 50, offset: int = 0) -> dict:
    """Contacts: Export contacts as JSON (limit≤200)."""
    try:
        safe_limit = max(0, min(int(limit), 200)) or 50
        safe_offset = max(0, int(offset))
        result = await client(functions.contacts.GetContactsRequest(hash=0))
        users = result.users or []
        sliced = users[safe_offset : safe_offset + safe_limit]
        return {
            "ok": True,
            "total": len(users),
            "limit": safe_limit,
            "offset": safe_offset,
            "contacts": [format_entity(u) for u in sliced],
        }
    except Exception as e:
        return {"ok": False, "error": log_and_format_error("telegram_export_contacts", e)}




async def telegram_get_blocked_users(limit: int = 10, offset: int = 0) -> dict:
    """Contacts: List blocked users as JSON (limit≤200)."""
    try:
        safe_limit = max(0, min(int(limit), 200)) or 10
        safe_offset = max(0, int(offset))
        result = await client(functions.contacts.GetBlockedRequest(offset=safe_offset, limit=safe_limit))
        users = getattr(result, "users", []) or []
        total = getattr(result, "count", None)
        return {
            "ok": True,
            "total": total if isinstance(total, int) else None,
            "limit": safe_limit,
            "offset": safe_offset,
            "users": [format_entity(u) for u in users],
        }
    except Exception as e:
        return {"ok": False, "error": log_and_format_error("telegram_get_blocked_users", e)}



