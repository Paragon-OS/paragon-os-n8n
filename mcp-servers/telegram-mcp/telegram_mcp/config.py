"""
Configuration for Telegram MCP
Auto-generated from main.py refactoring
"""

import os
import logging
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.sessions import StringSession

load_dotenv()

# Telegram API configuration
TELEGRAM_API_ID = int(os.getenv("TELEGRAM_API_ID"))
TELEGRAM_API_HASH = os.getenv("TELEGRAM_API_HASH")
TELEGRAM_SESSION_NAME = os.getenv("TELEGRAM_SESSION_NAME")

# Check if a string session exists in environment, otherwise use file-based session
SESSION_STRING = os.getenv("TELEGRAM_SESSION_STRING")

# Initialize Telegram client
if SESSION_STRING:
    # Use the string session if available
    client = TelegramClient(StringSession(SESSION_STRING), TELEGRAM_API_ID, TELEGRAM_API_HASH)
else:
    # Use file-based session
    client = TelegramClient(TELEGRAM_SESSION_NAME, TELEGRAM_API_ID, TELEGRAM_API_HASH)

# Setup robust logging with both file and console output
logger = logging.getLogger("telegram_mcp")
logger.setLevel(logging.ERROR)  # Set to ERROR for production, INFO for debugging

# Create console handler
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.ERROR)  # Set to ERROR for production, INFO for debugging

# Create file handler with absolute path
script_dir = os.path.dirname(os.path.abspath(__file__))
log_file_path = os.path.join(script_dir, "mcp_errors.log")

try:
    file_handler = logging.FileHandler(log_file_path, mode="a")  # Append mode
    file_handler.setLevel(logging.ERROR)

    # Create formatter and add to handlers
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s - %(message)s - %(filename)s:%(lineno)d"
    )
    console_handler.setFormatter(formatter)
    file_handler.setFormatter(formatter)

    # Add handlers to logger
    logger.addHandler(console_handler)
    logger.addHandler(file_handler)

    logger.info(f"Logging initialized to {log_file_path}")
except Exception as log_error:
    print(f"WARNING: Error setting up log file: {log_error}")
    # Fallback to console-only logging
    logger.addHandler(console_handler)
    logger.error(f"Failed to set up log file handler: {log_error}")

# Suppress verbose Telethon logs
logging.getLogger("telethon").setLevel(logging.ERROR)
logging.getLogger("telethon.network").setLevel(logging.ERROR)
logging.getLogger("telethon.network.mtprotosender").setLevel(logging.ERROR)
logging.getLogger("telethon.network.connection").setLevel(logging.ERROR)
