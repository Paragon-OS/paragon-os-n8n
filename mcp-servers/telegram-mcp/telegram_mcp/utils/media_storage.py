"""
Media Storage Utility for Telegram MCP
Handles persistent storage and tracking of downloaded media files
"""

import os
import json
import shutil
from pathlib import Path
from datetime import datetime
from typing import Dict, Optional, List, Tuple
import mimetypes
import logging

logger = logging.getLogger("telegram_mcp")


class MediaStorage:
    """Manages persistent storage of downloaded Telegram media files."""
    
    def __init__(self, base_dir: Optional[str] = None):
        """
        Initialize MediaStorage.
        
        Args:
            base_dir: Base directory for media storage. Defaults to ~/.telegram-mcp/media/
        """
        if base_dir is None:
            self.base_dir = Path.home() / ".telegram-mcp" / "media"
        else:
            self.base_dir = Path(base_dir)
        
        self.index_file = self.base_dir / "index.json"
        self._ensure_directories()
        self._load_index()
    
    def _ensure_directories(self):
        """Create necessary directories if they don't exist."""
        self.base_dir.mkdir(parents=True, exist_ok=True)
    
    def _load_index(self):
        """Load the media index from disk."""
        if self.index_file.exists():
            try:
                with open(self.index_file, 'r', encoding='utf-8') as f:
                    self.index = json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                logger.warning(f"Failed to load media index: {e}. Starting with empty index.")
                self.index = {}
        else:
            self.index = {}
    
    def _save_index(self):
        """Save the media index to disk."""
        try:
            with open(self.index_file, 'w', encoding='utf-8') as f:
                json.dump(self.index, f, indent=2, ensure_ascii=False)
        except IOError as e:
            logger.error(f"Failed to save media index: {e}")
            raise
    
    def _get_key(self, chat_id: int, message_id: int) -> str:
        """Generate a unique key for chat_id and message_id."""
        return f"{chat_id}|{message_id}"
    
    def _get_file_path(self, chat_id: int, message_id: int, extension: str) -> Path:
        """Generate a file path for the media file."""
        filename = f"chat{chat_id}_msg{message_id}{extension}"
        return self.base_dir / filename
    
    def save_media(self, chat_id: int, message_id: int, source_path: str, mime_type: Optional[str] = None) -> str:
        """
        Save media file to storage and update index.
        
        Args:
            chat_id: Telegram chat ID
            message_id: Telegram message ID
            source_path: Path to the source media file
            mime_type: MIME type of the media (auto-detected if not provided)
            
        Returns:
            Path to the saved media file
            
        Raises:
            FileNotFoundError: If source file doesn't exist
            IOError: If file operations fail
        """
        source_path = Path(source_path)
        if not source_path.exists():
            raise FileNotFoundError(f"Source file not found: {source_path}")
        
        # Detect MIME type if not provided
        if mime_type is None:
            mime_type, _ = mimetypes.guess_type(str(source_path))
            if mime_type is None:
                mime_type = "application/octet-stream"
        
        # Determine file extension
        extension = source_path.suffix
        if not extension:
            # Try to get extension from MIME type
            ext_map = {
                'image/jpeg': '.jpg',
                'image/png': '.png',
                'image/gif': '.gif',
                'image/webp': '.webp',
                'video/mp4': '.mp4',
                'audio/mpeg': '.mp3',
                'audio/ogg': '.ogg',
                'application/pdf': '.pdf',
            }
            extension = ext_map.get(mime_type, '.bin')
        
        # Generate destination path
        dest_path = self._get_file_path(chat_id, message_id, extension)
        
        # Copy file to storage
        shutil.copy2(source_path, dest_path)
        
        # Get file size
        file_size = dest_path.stat().st_size
        
        # Update index
        key = self._get_key(chat_id, message_id)
        self.index[key] = {
            "path": str(dest_path),
            "mime_type": mime_type,
            "timestamp": datetime.now().isoformat(),
            "size": file_size,
            "extension": extension
        }
        
        self._save_index()
        
        logger.info(f"Saved media: {source_path} -> {dest_path}")
        return str(dest_path)
    
    def get_media(self, chat_id: int, message_id: int) -> Optional[Dict]:
        """
        Get media metadata from storage.
        
        Args:
            chat_id: Telegram chat ID
            message_id: Telegram message ID
            
        Returns:
            Media metadata dict or None if not found
        """
        key = self._get_key(chat_id, message_id)
        return self.index.get(key)
    
    def get_media_path(self, chat_id: int, message_id: int) -> Optional[str]:
        """
        Get the file path for stored media.
        
        Args:
            chat_id: Telegram chat ID
            message_id: Telegram message ID
            
        Returns:
            File path or None if not found
        """
        media_info = self.get_media(chat_id, message_id)
        if media_info and os.path.exists(media_info["path"]):
            return media_info["path"]
        return None
    
    def list_media(self) -> List[Dict]:
        """
        List all stored media.
        
        Returns:
            List of media metadata dictionaries
        """
        # Filter out entries where files no longer exist
        valid_media = []
        stale_keys = []
        
        for key, media_info in self.index.items():
            if os.path.exists(media_info["path"]):
                chat_id, message_id = key.split("|")
                media_info["chat_id"] = int(chat_id)
                media_info["message_id"] = int(message_id)
                valid_media.append(media_info)
            else:
                # Mark stale entries for removal
                stale_keys.append(key)
        
        # Remove stale entries after iteration
        if stale_keys:
            for key in stale_keys:
                del self.index[key]
            self._save_index()
        
        return valid_media
    
    def delete_media(self, chat_id: int, message_id: int) -> bool:
        """
        Delete media file and remove from index.
        
        Args:
            chat_id: Telegram chat ID
            message_id: Telegram message ID
            
        Returns:
            True if deleted, False if not found
        """
        key = self._get_key(chat_id, message_id)
        if key not in self.index:
            return False
        
        media_info = self.index[key]
        file_path = media_info["path"]
        
        # Delete file if it exists
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError as e:
                logger.warning(f"Failed to delete media file {file_path}: {e}")
        
        # Remove from index
        del self.index[key]
        self._save_index()
        
        logger.info(f"Deleted media: {file_path}")
        return True
    
    def clear_all_media(self) -> int:
        """
        Clear all stored media files and index.
        
        Returns:
            Number of files deleted
        """
        deleted_count = 0
        
        for media_info in self.index.values():
            file_path = media_info["path"]
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                    deleted_count += 1
                except OSError as e:
                    logger.warning(f"Failed to delete media file {file_path}: {e}")
        
        self.index.clear()
        self._save_index()
        
        logger.info(f"Cleared all media: {deleted_count} files deleted")
        return deleted_count
    
    def get_storage_stats(self) -> Dict:
        """
        Get storage statistics.
        
        Returns:
            Dictionary with storage stats
        """
        media_list = self.list_media()
        total_size = sum(media["size"] for media in media_list)
        
        return {
            "total_files": len(media_list),
            "total_size_bytes": total_size,
            "total_size_mb": round(total_size / (1024 * 1024), 2),
            "storage_path": str(self.base_dir)
        }
