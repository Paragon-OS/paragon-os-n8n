"""
Chats: Core chat listing, lookup, membership and invites (concise, JSON returns).
"""

from mcp.server.fastmcp import FastMCP
from telethon import TelegramClient, functions, utils
from telethon.tl.types import *
import telethon.errors.rpcerrorlist
import logging
import json
import os
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Union, Any

# Import shared utilities
from ..utils.helpers import (
    format_entity,
    format_message,
    get_sender_name,
    json_serializer,
    format_dialog_summary,
    get_entity_kind,
    truncate,
    get_entity_with_fallback,
)
from ..utils.errors import log_and_format_error, ErrorCategory

# Import configuration
from ..config import client, logger

# Get logger
logger = logging.getLogger("telegram_mcp")


async def telegram_get_chats(page: int = 1, page_size: int = 10) -> str:
    """List chats as JSON summaries (paged). Broadcast channels are excluded."""
    try:
        # Enforce sane limits
        page = max(1, int(page))
        page_size = max(1, min(int(page_size), 200))
        
        # Calculate how many dialogs to skip
        skip_count = (page - 1) * page_size
        
        # Fetch dialogs with offset, getting extra to account for filtered broadcast channels
        # We fetch more than needed because some may be filtered out
        fetch_limit = page_size + 50  # Buffer for filtered items
        offset_dialogs = []
        offset_date = None
        offset_id = 0
        offset_peer = None
        skipped = 0
        
        # Skip to the right page
        if skip_count > 0:
            temp_dialogs = await client.get_dialogs(limit=skip_count + 1)
            if len(temp_dialogs) > skip_count:
                last = temp_dialogs[skip_count]
                if last.message:
                    offset_date = last.message.date
                    offset_id = last.message.id
                    offset_peer = last.entity
        
        # Fetch the actual page
        if offset_peer is not None:
            dialogs = await client.get_dialogs(
                limit=fetch_limit,
                offset_date=offset_date,
                offset_id=offset_id,
                offset_peer=offset_peer
            )
        else:
            dialogs = await client.get_dialogs(limit=fetch_limit)
        
        # Filter out broadcast channels
        filtered_dialogs = [d for d in dialogs if get_entity_kind(d.entity) is not None]
        
        # Return only the requested page_size
        chats = filtered_dialogs[:page_size]
        payload = {
            "items": [format_dialog_summary(d) for d in chats],
            "page": page,
            "page_size": page_size,
        }
        return json.dumps(payload, indent=2, default=json_serializer)
    except Exception as e:
        return log_and_format_error("telegram_get_chats", e)




async def telegram_list_chats(chat_type: str = None, limit: int = 10) -> str:
    """List recent chats as JSON summaries; optional kind filter accepting `user`, `group`, or `channel` (case-insensitive). Note: `group` includes both basic groups and supergroups. `channel` is an alias that returns both users and groups. Broadcast channels are excluded."""
    try:
        # Enforce sane limit
        limit = max(1, min(int(limit), 200))
        
        results = []
        offset_date = None
        offset_id = 0
        offset_peer = None
        total_checked = 0
        batch_size = 100  # Increased from 50 to reduce API calls for higher limits
        max_total_checked = 500  # Safety limit to prevent infinite loops
        
        # Normalize chat_type - "channel" is an alias for both user and group
        filter_types = None
        if chat_type:
            chat_type_lower = chat_type.lower()
            if chat_type_lower == "channel":
                filter_types = ["user", "group"]
            else:
                filter_types = [chat_type_lower]
        
        # If no chat_type filter, just fetch the requested limit directly
        if not filter_types:
            dialogs = await client.get_dialogs(limit=limit)
            for dialog in dialogs:
                kind = get_entity_kind(dialog.entity)
                # Skip broadcast channels (kind will be None)
                if kind is not None:
                    results.append(format_dialog_summary(dialog))
        else:
            # With chat_type filter, fetch in batches until we have enough matches
            while len(results) < limit and total_checked < max_total_checked:
                # Fetch a batch of dialogs
                # Only pass offset parameters if they're set (not on first iteration)
                if offset_peer is not None:
                    batch = await client.get_dialogs(
                        limit=batch_size,
                        offset_date=offset_date,
                        offset_id=offset_id,
                        offset_peer=offset_peer
                    )
                else:
                    batch = await client.get_dialogs(limit=batch_size)
                
                # If no more dialogs, break
                if not batch:
                    break
                
                # Filter and collect matching dialogs
                for dialog in batch:
                    entity = dialog.entity
                    kind = get_entity_kind(entity)
                    # Skip broadcast channels (kind will be None) and check if matches filter
                    if kind is not None and kind in filter_types:
                        results.append(format_dialog_summary(dialog))
                        # Stop if we've collected enough
                        if len(results) >= limit:
                            break
                
                total_checked += len(batch)
                
                # If we got fewer dialogs than requested, we've reached the end
                if len(batch) < batch_size:
                    break
                
                # Update offset for next batch
                # Use the last dialog's message for offset, or skip offset if no message
                last_dialog = batch[-1]
                if last_dialog.message:
                    offset_date = last_dialog.message.date
                    offset_id = last_dialog.message.id
                    offset_peer = last_dialog.entity
                else:
                    # If there's no message, we can't properly paginate, so stop
                    break

        return json.dumps({"items": results, "limit": limit}, indent=2, default=json_serializer)
    except Exception as e:
        return log_and_format_error("telegram_list_chats", e, chat_type=chat_type, limit=limit)




async def telegram_get_chat(chat_id: int) -> str:
    """Get a chat by id as a JSON object with basic stats. Note: broadcast channels will have kind=null as they are not supported."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)
        result = {"id": entity.id, "kind": get_entity_kind(entity)}

        is_channel = isinstance(entity, Channel)
        is_chat = isinstance(entity, Chat)
        is_user = isinstance(entity, User)

        if hasattr(entity, "title"):
            result["name"] = entity.title
            result["username"] = getattr(entity, "username", None)
            try:
                participants_count = (await client.get_participants(entity, limit=0)).total
                result["participants"] = participants_count
            except Exception:
                pass

        elif is_user:
            name = f"{entity.first_name}" + (f" {entity.last_name}" if entity.last_name else "")
            result.update({
                "name": name.strip(),
                "username": getattr(entity, "username", None),
                "phone": getattr(entity, "phone", None),
                "bot": bool(getattr(entity, "bot", False)),
                "verified": bool(getattr(entity, "verified", False)),
            })

        # Get last activity if it's a dialog
        try:
            dialog = await client.get_dialogs(limit=1, offset_id=0, offset_peer=entity)
            if dialog:
                dialog = dialog[0]
                result["unread"] = getattr(dialog, "unread_count", 0) or 0
                if dialog.message:
                    last_msg = dialog.message
                    sender_name = get_sender_name(last_msg)
                    result["last_message"] = {
                        "id": last_msg.id,
                        "from": sender_name,
                        "date": last_msg.date.isoformat(),
                        "text_excerpt": truncate(last_msg.message or "", 160),
                    }
        except Exception as diag_ex:
            logger.warning(f"Could not get dialog info for {chat_id}: {diag_ex}")

        return json.dumps(result, indent=2, default=json_serializer)
    except Exception as e:
        return log_and_format_error("telegram_get_chat", e, chat_id=chat_id)




async def telegram_read_channel(
    chat_id: Optional[int] = None,
    channelId: Optional[int] = None,
    limit: Optional[int] = None
) -> str:
    """Alias: read a group or user by id; delegates to get_chat. Broadcast channels are not supported."""
    # Normalize parameter names: prioritize original name, fall back to alternative
    actual_chat_id = chat_id if chat_id is not None else channelId
    
    # Validate that we have a required parameter
    if actual_chat_id is None:
        return log_and_format_error("telegram_read_channel", ValueError("Missing required parameter: chat_id or channelId"), chat_id=None)
    
    return await telegram_get_chat(actual_chat_id)




async def telegram_get_pending_chats(
    limit: int = 10,
    context_messages: int = 5,
    include_archived: bool = True,
    include_muted: bool = True,
) -> str:
    """List chats needing attention (unread or last inbound), with recent context as JSON."""
    try:
        # Get current user info to identify own messages
        me = await client.get_me()
        my_id = me.id
        
        # Fetch all dialogs
        dialogs = await client.get_dialogs()
        
        pending_chats = []
        
        for dialog in dialogs:
            entity = dialog.entity
            
            # Filter by chat type: only private chats and groups (exclude broadcast channels)
            if isinstance(entity, Channel) and not entity.megagroup:
                continue  # Skip broadcast channels, but include groups (megagroups are groups)
            
            # Apply archive filter
            if not include_archived and dialog.archived:
                continue
                
            # Apply mute filter
            if not include_muted and getattr(dialog, 'notify_settings', None):
                # Check if chat is muted
                notify_settings = dialog.notify_settings
                if (hasattr(notify_settings, 'mute_until') and 
                    notify_settings.mute_until and 
                    notify_settings.mute_until > datetime.now()):
                    continue
            
            # Check if chat is pending (has unread messages OR last message is from someone else)
            is_pending = False
            
            # Criterion 1: Has unread messages
            if dialog.unread_count > 0:
                is_pending = True
            
            # Criterion 2: Last message was from someone else (not user)
            elif dialog.message and not dialog.message.out:
                is_pending = True
            
            if is_pending:
                # Get chat type for display
                if isinstance(entity, User):
                    chat_type = "Private"
                elif isinstance(entity, Chat):
                    chat_type = "Group"
                elif isinstance(entity, Channel) and entity.megagroup:
                    chat_type = "Group"
                else:
                    chat_type = "Unknown"
                
                # Get chat name
                chat_name = getattr(entity, "title", None) or getattr(entity, "first_name", "Unknown")
                if hasattr(entity, "last_name") and entity.last_name:
                    chat_name += f" {entity.last_name}"
                
                # Get recent messages for context
                try:
                    recent_messages = await client.get_messages(entity, limit=context_messages)
                    
                    message_lines = []
                    for msg in reversed(recent_messages):  # Show oldest first for chronological order
                        sender_name = "You" if msg.out else get_sender_name(msg)
                        message_text = msg.message or "[Media/No text]"
                        # Truncate long messages
                        if len(message_text) > 100:
                            message_text = message_text[:97] + "..."
                        
                        message_lines.append(
                            f"- ID: {msg.id} | {sender_name} | {msg.date.strftime('%Y-%m-%d %H:%M')} | {message_text}"
                        )
                    
                    chat_info = {
                        'entity': entity,
                        'chat_name': chat_name,
                        'chat_type': chat_type,
                        'unread_count': dialog.unread_count,
                        'message_lines': message_lines,
                        'last_message_date': dialog.message.date if dialog.message else None
                    }
                    
                    pending_chats.append(chat_info)
                    
                except Exception as msg_error:
                    # If we can't get messages, still include the chat but note the error
                    logger.warning(f"Could not fetch messages for chat {entity.id}: {msg_error}")
                    chat_info = {
                        'entity': entity,
                        'chat_name': chat_name,
                        'chat_type': chat_type,
                        'unread_count': dialog.unread_count,
                        'message_lines': ["- [Error fetching recent messages]"],
                        'last_message_date': dialog.message.date if dialog.message else None
                    }
                    pending_chats.append(chat_info)
            
            # Stop if we've reached the limit
            if len(pending_chats) >= limit:
                break
        
        # Sort by last message date (most recent first)
        pending_chats.sort(
            key=lambda x: x['last_message_date'] or datetime.min,
            reverse=True
        )

        # Emit JSON
        payload = []
        for chat_info in pending_chats:
            entity = chat_info['entity']
            payload.append({
                "id": entity.id,
                "name": chat_info['chat_name'],
                "kind": chat_info['chat_type'].lower(),
                "unread": chat_info['unread_count'],
                "messages": chat_info['message_lines'],
                "last_message_date": chat_info['last_message_date'].isoformat() if chat_info['last_message_date'] else None,
            })

        return json.dumps({"items": payload}, indent=2, default=json_serializer)
        
    except Exception as e:
        return log_and_format_error(
            "telegram_get_pending_chats", 
            e, 
            limit=limit, 
            context_messages=context_messages,
            include_archived=include_archived,
            include_muted=include_muted
        )




async def telegram_get_direct_chat_by_contact(contact_query: str) -> str:
    """Find direct chats for contacts matching a query; returns JSON list."""
    try:
        # Fetch all contacts using the correct Telethon method
        result = await client(functions.contacts.GetContactsRequest(hash=0))
        contacts = result.users
        found_contacts = []
        for contact in contacts:
            if not contact:
                continue
            name = (
                f"{getattr(contact, 'first_name', '')} {getattr(contact, 'last_name', '')}".strip()
            )
            username = getattr(contact, "username", "")
            phone = getattr(contact, "phone", "")
            if (
                contact_query.lower() in name.lower()
                or (username and contact_query.lower() in username.lower())
                or (phone and contact_query in phone)
            ):
                found_contacts.append(contact)
        if not found_contacts:
            return json.dumps({"items": []}, indent=2)
        # If we found contacts, look for direct chats with them
        results = []
        dialogs = await client.get_dialogs()
        for contact in found_contacts:
            contact_name = (
                f"{getattr(contact, 'first_name', '')} {getattr(contact, 'last_name', '')}".strip()
            )
            for dialog in dialogs:
                if isinstance(dialog.entity, User) and dialog.entity.id == contact.id:
                    results.append({
                        "id": dialog.entity.id,
                        "contact": contact_name,
                        "username": getattr(contact, "username", None),
                        "unread": getattr(dialog, "unread_count", 0) or 0,
                    })
                    break
        return json.dumps({"items": results}, indent=2, default=json_serializer)
    except Exception as e:
        return log_and_format_error("telegram_get_direct_chat_by_contact", e, contact_query=contact_query)




async def telegram_get_contact_chats(contact_id: int) -> str:
    """List direct chat and common groups for a contact as JSON."""
    try:
        # Get contact info
        contact = await get_entity_with_fallback(client, contact_id)
        if not isinstance(contact, User):
            return f"ID {contact_id} is not a user/contact."

        contact_name = (
            f"{getattr(contact, 'first_name', '')} {getattr(contact, 'last_name', '')}".strip()
        )

        # Find direct chat
        direct_chat = None
        dialogs = await client.get_dialogs()

        results = {"contact": {"id": contact.id, "name": contact_name}, "direct": None, "common": []}

        # Look for direct chat
        for dialog in dialogs:
            if isinstance(dialog.entity, User) and dialog.entity.id == contact_id:
                results["direct"] = {"id": dialog.entity.id, "kind": "private", "unread": getattr(dialog, "unread_count", 0) or 0}
                break

        # Look for common groups (broadcast channels excluded)
        common_chats = []
        try:
            common = await client.get_common_chats(contact)
            for chat in common:
                # Skip broadcast channels
                if isinstance(chat, Channel) and getattr(chat, "broadcast", False):
                    continue
                chat_type = "group"
                results["common"].append({"id": chat.id, "name": chat.title, "kind": chat_type})
        except:
            results.append("Could not retrieve common groups.")

        return json.dumps(results, indent=2, default=json_serializer)
    except Exception as e:
        return log_and_format_error("telegram_get_contact_chats", e, contact_id=contact_id)




async def telegram_create_group(title: str, user_ids: list) -> str:
    """Create a basic group with users; returns ok/message."""
    try:
        # Convert user IDs to entities
        users = []
        for user_id in user_ids:
            try:
                user = await get_entity_with_fallback(client, user_id)
                users.append(user)
            except Exception as e:
                logger.error(f"Failed to get entity for user ID {user_id}: {e}")
                return f"Error: Could not find user with ID {user_id}"

        if not users:
            return "Error: No valid users provided"

        # Create the group with the users
        try:
            # Create a new chat with selected users
            result = await client(functions.messages.CreateChatRequest(users=users, title=title))

            # Check what type of response we got
            if hasattr(result, "chats") and result.chats:
                created_chat = result.chats[0]
                return json.dumps({"ok": True, "message": f"Group created", "id": created_chat.id})
            elif hasattr(result, "chat") and result.chat:
                return json.dumps({"ok": True, "message": "Group created", "id": result.chat.id})
            elif hasattr(result, "chat_id"):
                return json.dumps({"ok": True, "message": "Group created", "id": result.chat_id})
            else:
                # If we can't determine the chat ID directly from the result
                # Try to find it in recent dialogs
                await asyncio.sleep(1)  # Give Telegram a moment to register the new group
                dialogs = await client.get_dialogs(limit=5)  # Get recent dialogs
                for dialog in dialogs:
                    if dialog.title == title:
                        return json.dumps({"ok": True, "message": "Group created", "id": dialog.id})

                # If we still can't find it, at least return success
                return json.dumps({"ok": True, "message": f"Group created. Check recent chats for '{title}'."})

        except Exception as create_err:
            if "PEER_FLOOD" in str(create_err):
                return "Error: Cannot create group due to Telegram limits. Try again later."
            else:
                raise  # Let the outer exception handler catch it
    except Exception as e:
        logger.exception(f"telegram_create_group failed (title={title}, user_ids={user_ids})")
        return log_and_format_error("telegram_create_group", e, title=title, user_ids=user_ids)




async def telegram_leave_chat(chat_id: int) -> str:
    """Leave a group by id; returns ok/message. Broadcast channels are not supported."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)

        # Check the entity type carefully
        if isinstance(entity, Channel):
            # Check if it's a broadcast channel (not supported)
            if getattr(entity, "broadcast", False):
                return json.dumps({"ok": False, "error": "Leaving broadcast channels is not supported"})
            # Handle groups (supergroups are Channel type in Telegram API)
            try:
                await client(functions.channels.LeaveChannelRequest(channel=entity))
                chat_name = getattr(entity, "title", str(chat_id))
                return json.dumps({"ok": True, "message": f"Left group {chat_name}", "id": chat_id})
            except Exception as chan_err:
                return log_and_format_error("telegram_leave_chat", chan_err, chat_id=chat_id)

        elif isinstance(entity, Chat):
            # Traditional basic groups
            try:
                # First try with InputPeerUser
                me = await client.get_me(input_peer=True)
                await client(
                    functions.messages.DeleteChatUserRequest(
                        chat_id=entity.id, user_id=me  # Use the entity ID directly
                    )
                )
                chat_name = getattr(entity, "title", str(chat_id))
                return json.dumps({"ok": True, "message": f"Left basic group {chat_name}", "id": chat_id})
            except Exception as chat_err:
                # If the above fails, try the second approach
                logger.warning(
                    f"First leave attempt failed: {chat_err}, trying alternative method"
                )

                try:
                    # Alternative approach - sometimes this works better
                    me_full = await client.get_me()
                    await client(
                        functions.messages.DeleteChatUserRequest(
                            chat_id=entity.id, user_id=me_full.id
                        )
                    )
                    chat_name = getattr(entity, "title", str(chat_id))
                    return json.dumps({"ok": True, "message": f"Left basic group {chat_name}", "id": chat_id})
                except Exception as alt_err:
                    return log_and_format_error("telegram_leave_chat", alt_err, chat_id=chat_id)
        else:
            # Cannot leave a user chat this way
            entity_type = type(entity).__name__
            return log_and_format_error(
                "telegram_leave_chat",
                Exception(
                    f"Cannot leave chat ID {chat_id} of type {entity_type}. This function is for groups and channels only."
                ),
                chat_id=chat_id,
            )

    except Exception as e:
        logger.exception(f"telegram_leave_chat failed (chat_id={chat_id})")

        # Provide helpful hint for common errors
        error_str = str(e).lower()
        if "invalid" in error_str and "chat" in error_str:
            return log_and_format_error(
                "telegram_leave_chat",
                Exception(
                    f"Error leaving chat: Please check the chat ID and try again. Note: broadcast channels are not supported."
                ),
                chat_id=chat_id,
            )

        return log_and_format_error("telegram_leave_chat", e, chat_id=chat_id)




async def telegram_create_channel(title: str, about: str = "", megagroup: bool = False) -> str:
    """Create a group; set megagroup=True (recommended) to create a group with extended features; returns ok/message and id. Note: broadcast channels (megagroup=False) are not recommended for use with this MCP server."""
    try:
        result = await client(
            functions.channels.CreateChannelRequest(title=title, about=about, megagroup=megagroup)
        )
        return json.dumps({"ok": True, "message": f"Channel '{title}' created", "id": result.chats[0].id})
    except Exception as e:
        return log_and_format_error(
            "create_channel", e, title=title, about=about, megagroup=megagroup
        )




async def telegram_edit_chat_title(chat_id: int, title: str) -> str:
    """Edit chat title; returns ok/message."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)
        if isinstance(entity, Channel):
            await client(functions.channels.EditTitleRequest(channel=entity, title=title))
        elif isinstance(entity, Chat):
            await client(functions.messages.EditChatTitleRequest(chat_id=chat_id, title=title))
        else:
            return f"Cannot edit title for this entity type ({type(entity)})."
        return json.dumps({"ok": True, "message": f"Title updated", "id": chat_id, "title": title})
    except Exception as e:
        logger.exception(f"telegram_edit_chat_title failed (chat_id={chat_id}, title='{title}')")
        return log_and_format_error("telegram_edit_chat_title", e, chat_id=chat_id, title=title)




async def telegram_edit_chat_photo(chat_id: int, file_path: str) -> str:
    """Set chat photo from local file; returns ok/message."""
    try:
        if not os.path.isfile(file_path):
            return f"Photo file not found: {file_path}"
        if not os.access(file_path, os.R_OK):
            return f"Photo file not readable: {file_path}"

        entity = await get_entity_with_fallback(client, chat_id)
        uploaded_file = await client.upload_file(file_path)

        if isinstance(entity, Channel):
            # For groups (supergroups are Channel type in Telegram API), use EditPhotoRequest with InputChatUploadedPhoto
            input_photo = InputChatUploadedPhoto(file=uploaded_file)
            await client(functions.channels.EditPhotoRequest(channel=entity, photo=input_photo))
        elif isinstance(entity, Chat):
            # For basic groups, use EditChatPhotoRequest with InputChatUploadedPhoto
            input_photo = InputChatUploadedPhoto(file=uploaded_file)
            await client(
                functions.messages.EditChatPhotoRequest(chat_id=chat_id, photo=input_photo)
            )
        else:
            return f"Cannot edit photo for this entity type ({type(entity)})."

        return json.dumps({"ok": True, "message": "Photo updated", "id": chat_id})
    except Exception as e:
        logger.exception(f"telegram_edit_chat_photo failed (chat_id={chat_id}, file_path='{file_path}')")
        return log_and_format_error("telegram_edit_chat_photo", e, chat_id=chat_id, file_path=file_path)




async def telegram_delete_chat_photo(chat_id: int) -> str:
    """Delete chat photo; returns ok/message."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)
        if isinstance(entity, Channel):
            # Use InputChatPhotoEmpty for groups (supergroups are Channel type in Telegram API)
            await client(
                functions.channels.EditPhotoRequest(channel=entity, photo=InputChatPhotoEmpty())
            )
        elif isinstance(entity, Chat):
            # Use None (or InputChatPhotoEmpty) for basic groups
            await client(
                functions.messages.EditChatPhotoRequest(
                    chat_id=chat_id, photo=InputChatPhotoEmpty()
                )
            )
        else:
            return f"Cannot delete photo for this entity type ({type(entity)})."

        return json.dumps({"ok": True, "message": "Photo deleted", "id": chat_id})
    except Exception as e:
        logger.exception(f"telegram_delete_chat_photo failed (chat_id={chat_id})")
        return log_and_format_error("telegram_delete_chat_photo", e, chat_id=chat_id)




async def telegram_get_invite_link(chat_id: int) -> str:
    """Get an invite link for a chat; returns the link as string (JSON)."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)

        # Try using ExportChatInviteRequest first
        try:
            from telethon.tl import functions

            result = await client(functions.messages.ExportChatInviteRequest(peer=entity))
            return json.dumps({"link": result.link})
        except AttributeError:
            # If the function doesn't exist in the current Telethon version
            logger.warning("ExportChatInviteRequest not available, using alternative method")
        except Exception as e1:
            # If that fails, log and try alternative approach
            logger.warning(f"ExportChatInviteRequest failed: {e1}")

        # Alternative approach using client.export_chat_invite_link
        try:
            invite_link = await client.export_chat_invite_link(entity)
            return json.dumps({"link": invite_link})
        except Exception as e2:
            logger.exception(f"telegram_export_chat_invite_link failed: {e2}")

        # Last resort: Try directly fetching chat info
        try:
            if isinstance(entity, (Chat, Channel)):
                full_chat = await client(functions.messages.GetFullChatRequest(chat_id=entity.id))
                if hasattr(full_chat, "full_chat") and hasattr(full_chat.full_chat, "invite_link"):
                    link = full_chat.full_chat.invite_link or None
                    return json.dumps({"link": link})
        except Exception as e3:
            logger.warning(f"GetFullChatRequest failed: {e3}")

        return json.dumps({"link": None})
    except Exception as e:
        logger.exception(f"telegram_get_invite_link failed (chat_id={chat_id})")
        return log_and_format_error("telegram_get_invite_link", e, chat_id=chat_id)




async def telegram_join_chat_by_link(link: str) -> str:
    """Join a chat by invite link; returns ok/message."""
    try:
        # Extract the hash from the invite link
        if "/" in link:
            hash_part = link.split("/")[-1]
            if hash_part.startswith("+"):
                hash_part = hash_part[1:]  # Remove the '+' if present
        else:
            hash_part = link

        # Try checking the invite before joining
        try:
            from telethon.errors import (
                InviteHashExpiredError,
                InviteHashInvalidError,
                UserAlreadyParticipantError,
                ChatAdminRequiredError,
                UsersTooMuchError,
            )

            # Try to check invite info first (will often fail if not a member)
            invite_info = await client(functions.messages.CheckChatInviteRequest(hash=hash_part))
            if hasattr(invite_info, "chat") and invite_info.chat:
                # If we got chat info, we're already a member
                chat_title = getattr(invite_info.chat, "title", "Unknown Chat")
                return json.dumps({"ok": True, "message": f"Already a member of {chat_title}"})
        except Exception as check_err:
            # This often fails if not a member - just continue
            pass

        # Join the chat using the hash
        try:
            result = await client(functions.messages.ImportChatInviteRequest(hash=hash_part))
            if result and hasattr(result, "chats") and result.chats:
                chat_title = getattr(result.chats[0], "title", "Unknown Chat")
                return json.dumps({"ok": True, "message": f"Joined {chat_title}"})
            return json.dumps({"ok": True, "message": "Joined via invite"})
        except Exception as join_err:
            err_str = str(join_err).lower()
            if "expired" in err_str:
                return "The invite hash has expired and is no longer valid."
            elif "invalid" in err_str:
                return "The invite hash is invalid or malformed."
            elif "already" in err_str and "participant" in err_str:
                return "You are already a member of this chat."
            elif "admin" in err_str:
                return "Cannot join this chat - requires admin approval."
            elif "too much" in err_str or "too many" in err_str:
                return "Cannot join this chat - it has reached maximum number of participants."
            else:
                raise  # Re-raise to be caught by the outer exception handler
    except Exception as e:
        logger.exception(f"telegram_join_chat_by_link failed (link={link})")
        return log_and_format_error("telegram_join_chat_by_link", e, link=link)




async def telegram_export_chat_invite(chat_id: int) -> str:
    """Alias: export chat invite; returns {link}."""
    try:
        entity = await get_entity_with_fallback(client, chat_id)

        # Try using ExportChatInviteRequest first
        try:
            from telethon.tl import functions

            result = await client(functions.messages.ExportChatInviteRequest(peer=entity))
            return json.dumps({"link": result.link})
        except AttributeError:
            # If the function doesn't exist in the current Telethon version
            logger.warning("ExportChatInviteRequest not available, using alternative method")
        except Exception as e1:
            # If that fails, log and try alternative approach
            logger.warning(f"ExportChatInviteRequest failed: {e1}")

        # Alternative approach using client.export_chat_invite_link
        try:
            invite_link = await client.export_chat_invite_link(entity)
            return json.dumps({"link": invite_link})
        except Exception as e2:
            logger.exception(f"telegram_export_chat_invite_link failed: {e2}")
            return log_and_format_error("telegram_export_chat_invite", e2, chat_id=chat_id)
    except Exception as e:
        logger.exception(f"telegram_export_chat_invite failed (chat_id={chat_id})")
        return log_and_format_error("telegram_export_chat_invite", e, chat_id=chat_id)




async def telegram_import_chat_invite(hash: str) -> str:
    """Alias: join by invite hash; returns ok/message."""
    try:
        # Remove any prefixes like '+' if present
        if hash.startswith("+"):
            hash = hash[1:]

        # Try checking the invite before joining
        try:
            from telethon.errors import (
                InviteHashExpiredError,
                InviteHashInvalidError,
                UserAlreadyParticipantError,
                ChatAdminRequiredError,
                UsersTooMuchError,
            )

            # Try to check invite info first (will often fail if not a member)
            invite_info = await client(functions.messages.CheckChatInviteRequest(hash=hash))
            if hasattr(invite_info, "chat") and invite_info.chat:
                # If we got chat info, we're already a member
                chat_title = getattr(invite_info.chat, "title", "Unknown Chat")
                return json.dumps({"ok": True, "message": f"Already a member of {chat_title}"})
        except Exception as check_err:
            # This often fails if not a member - just continue
            pass

        # Join the chat using the hash
        try:
            result = await client(functions.messages.ImportChatInviteRequest(hash=hash))
            if result and hasattr(result, "chats") and result.chats:
                chat_title = getattr(result.chats[0], "title", "Unknown Chat")
                return json.dumps({"ok": True, "message": f"Joined {chat_title}"})
            return json.dumps({"ok": True, "message": "Joined via invite"})
        except Exception as join_err:
            err_str = str(join_err).lower()
            if "expired" in err_str:
                return "The invite hash has expired and is no longer valid."
            elif "invalid" in err_str:
                return "The invite hash is invalid or malformed."
            elif "already" in err_str and "participant" in err_str:
                return "You are already a member of this chat."
            elif "admin" in err_str:
                return "Cannot join this chat - requires admin approval."
            elif "too much" in err_str or "too many" in err_str:
                return "Cannot join this chat - it has reached maximum number of participants."
            else:
                raise  # Re-raise to be caught by the outer exception handler
    except Exception as e:
        logger.exception(f"telegram_import_chat_invite failed (hash={hash})")
        return log_and_format_error("telegram_import_chat_invite", e, hash=hash)




async def telegram_archive_chat(chat_id: int) -> str:
    """Archive a chat; returns ok/message."""
    try:
        await client(
            functions.messages.ToggleDialogPinRequest(
                peer=await get_entity_with_fallback(client, chat_id), pinned=True
            )
        )
        return json.dumps({"ok": True, "message": "Archived", "id": chat_id})
    except Exception as e:
        return log_and_format_error("telegram_archive_chat", e, chat_id=chat_id)




async def telegram_unarchive_chat(chat_id: int) -> str:
    """Unarchive a chat; returns ok/message."""
    try:
        await client(
            functions.messages.ToggleDialogPinRequest(
                peer=await get_entity_with_fallback(client, chat_id), pinned=False
            )
        )
        return json.dumps({"ok": True, "message": "Unarchived", "id": chat_id})
    except Exception as e:
        return log_and_format_error("telegram_unarchive_chat", e, chat_id=chat_id)



