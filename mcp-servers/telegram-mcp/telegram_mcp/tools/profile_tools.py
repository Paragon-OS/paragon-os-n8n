"""
Telegram MCP Tools - Profile Functions
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


async def telegram_get_me() -> str:
    """
    Get your own user information.
    """
    try:
        me = await client.get_me()
        return json.dumps(format_entity(me), indent=2)
    except Exception as e:
        return log_and_format_error("telegram_get_me", e)




async def telegram_update_profile(first_name: str = None, last_name: str = None, about: str = None) -> str:
    """
    Update your profile information (name, bio).
    """
    try:
        await client(
            functions.account.UpdateProfileRequest(
                first_name=first_name, last_name=last_name, about=about
            )
        )
        return "Profile updated."
    except Exception as e:
        return log_and_format_error(
            "update_profile", e, first_name=first_name, last_name=last_name, about=about
        )




async def telegram_set_profile_photo(file_path: str) -> str:
    """
    Set a new profile photo.
    """
    try:
        await client(
            functions.photos.UploadProfilePhotoRequest(file=await client.upload_file(file_path))
        )
        return "Profile photo updated."
    except Exception as e:
        return log_and_format_error("telegram_set_profile_photo", e, file_path=file_path)




async def telegram_delete_profile_photo() -> str:
    """
    Delete your current profile photo.
    """
    try:
        photos = await client(
            functions.photos.GetUserPhotosRequest(user_id="me", offset=0, max_id=0, limit=1)
        )
        if not photos.photos:
            return "No profile photo to delete."
        await client(functions.photos.DeletePhotosRequest(id=[photos.photos[0].id]))
        return "Profile photo deleted."
    except Exception as e:
        return log_and_format_error("telegram_delete_profile_photo", e)




async def telegram_get_privacy_settings() -> str:
    """
    Get your privacy settings for last seen status.
    """
    try:
        # Import needed types directly
        from telethon.tl.types import InputPrivacyKeyStatusTimestamp

        try:
            settings = await client(
                functions.account.GetPrivacyRequest(key=InputPrivacyKeyStatusTimestamp())
            )
            return str(settings)
        except TypeError as e:
            if "TLObject was expected" in str(e):
                return "Error: Privacy settings API call failed due to type mismatch. This is likely a version compatibility issue with Telethon."
            else:
                raise
    except Exception as e:
        logger.exception("telegram_get_privacy_settings failed")
        return log_and_format_error("telegram_get_privacy_settings", e)




async def telegram_set_privacy_settings(
    key: str, allow_users: list = None, disallow_users: list = None
) -> str:
    """
    Set privacy settings (e.g., last seen, phone, etc.).

    Args:
        key: The privacy setting to modify ('status' for last seen, 'phone', 'profile_photo', etc.)
        allow_users: List of user IDs to allow
        disallow_users: List of user IDs to disallow
    """
    try:
        # Import needed types
        from telethon.tl.types import (
            InputPrivacyKeyStatusTimestamp,
            InputPrivacyKeyPhoneNumber,
            InputPrivacyKeyProfilePhoto,
            InputPrivacyValueAllowUsers,
            InputPrivacyValueDisallowUsers,
            InputPrivacyValueAllowAll,
            InputPrivacyValueDisallowAll,
        )

        # Map the simplified keys to their corresponding input types
        key_mapping = {
            "status": InputPrivacyKeyStatusTimestamp,
            "phone": InputPrivacyKeyPhoneNumber,
            "profile_photo": InputPrivacyKeyProfilePhoto,
        }

        # Get the appropriate key class
        if key not in key_mapping:
            return f"Error: Unsupported privacy key '{key}'. Supported keys: {', '.join(key_mapping.keys())}"

        privacy_key = key_mapping[key]()

        # Prepare the rules
        rules = []

        # Process allow rules
        if allow_users is None or len(allow_users) == 0:
            # If no specific users to allow, allow everyone by default
            rules.append(InputPrivacyValueAllowAll())
        else:
            # Convert user IDs to InputUser entities
            try:
                allow_entities = []
                for user_id in allow_users:
                    try:
                        user = await get_entity_with_fallback(client, user_id)
                        allow_entities.append(user)
                    except Exception as user_err:
                        logger.warning(f"Could not get entity for user ID {user_id}: {user_err}")

                if allow_entities:
                    rules.append(InputPrivacyValueAllowUsers(users=allow_entities))
            except Exception as allow_err:
                logger.error(f"Error processing allowed users: {allow_err}")
                return log_and_format_error("telegram_set_privacy_settings", allow_err, key=key)

        # Process disallow rules
        if disallow_users and len(disallow_users) > 0:
            try:
                disallow_entities = []
                for user_id in disallow_users:
                    try:
                        user = await get_entity_with_fallback(client, user_id)
                        disallow_entities.append(user)
                    except Exception as user_err:
                        logger.warning(f"Could not get entity for user ID {user_id}: {user_err}")

                if disallow_entities:
                    rules.append(InputPrivacyValueDisallowUsers(users=disallow_entities))
            except Exception as disallow_err:
                logger.error(f"Error processing disallowed users: {disallow_err}")
                return log_and_format_error("telegram_set_privacy_settings", disallow_err, key=key)

        # Apply the privacy settings
        try:
            result = await client(
                functions.account.SetPrivacyRequest(key=privacy_key, rules=rules)
            )
            return f"Privacy settings for {key} updated successfully."
        except TypeError as type_err:
            if "TLObject was expected" in str(type_err):
                return "Error: Privacy settings API call failed due to type mismatch. This is likely a version compatibility issue with Telethon."
            else:
                raise
    except Exception as e:
        logger.exception(f"telegram_set_privacy_settings failed (key={key})")
        return log_and_format_error("telegram_set_privacy_settings", e, key=key)




async def telegram_get_user_photos(user_id: int, limit: int = 10) -> str:
    """
    Get profile photos of a user.
    """
    try:
        user = await get_entity_with_fallback(client, user_id)
        photos = await client(
            functions.photos.GetUserPhotosRequest(user_id=user, offset=0, max_id=0, limit=limit)
        )
        return json.dumps([p.id for p in photos.photos], indent=2)
    except Exception as e:
        return log_and_format_error("telegram_get_user_photos", e, user_id=user_id, limit=limit)




async def telegram_get_user_status(user_id: int) -> str:
    """
    Get the online status of a user.
    """
    try:
        user = await get_entity_with_fallback(client, user_id)
        return str(user.status)
    except Exception as e:
        return log_and_format_error("telegram_get_user_status", e, user_id=user_id)



