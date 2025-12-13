"""
Error handling utilities for Telegram MCP
Auto-generated from main.py refactoring
"""

import logging
from enum import Enum
from typing import Optional

logger = logging.getLogger("telegram_mcp")

class ErrorCategory(str, Enum):
    CHAT = "CHAT"
    MSG = "MSG"
    CONTACT = "CONTACT"
    GROUP = "GROUP"
    MEDIA = "MEDIA"
    PROFILE = "PROFILE"
    AUTH = "AUTH"
    ADMIN = "ADMIN"

def log_and_format_error(
    function_name: str,
    error: Exception,
    prefix: Optional[ErrorCategory] = None,
    **kwargs,
) -> str:
    """
    Centralized error handling function.

    Logs an error and returns a formatted, user-friendly message.

    Args:
        function_name: Name of the function where the error occurred.
        error: The exception that was raised.
        prefix: Error code prefix (e.g., "CHAT", "MSG").
            If None, it will be derived from the function_name.
        **kwargs: Additional context parameters to include in the log.

    Returns:
        A user-friendly error message with an error code.
    """
    # Generate a consistent error code
    if prefix is None:
        # Try to derive prefix from function name
        for category in ErrorCategory:
            if category.name.lower() in function_name.lower():
                prefix = category
                break

    prefix_str = prefix.value if prefix else "GEN"

    error_code = f"{prefix_str}-ERR-{abs(hash(function_name)) % 1000:03d}"

    # Format the additional context parameters
    context = ", ".join(f"{k}={v}" for k, v in kwargs.items())

    # Log the full technical error
    logger.exception(f"{function_name} failed ({context}): {error}")

    # Return a user-friendly message
    return f"An error occurred (code: {error_code}). " f"Check mcp_errors.log for details."
