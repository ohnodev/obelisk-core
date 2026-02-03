"""
Memory Storage Node
Creates/accesses storage instances based on storage path
"""
from typing import Dict, Any, Optional
from pathlib import Path
from ..node_base import BaseNode, ExecutionContext
from src.utils.logger import get_logger

logger = get_logger(__name__)


class MemoryStorageNode(BaseNode):
    """
    Creates/accesses storage instances based on storage path
    
    Each node with the same storage_path shares the same storage instance.
    If storage_path is not provided, uses default ~/.obelisk-core/data/
    
    Inputs:
        storage_path: Path to storage directory (optional, default: ~/.obelisk-core/data/)
        storage_type: Type of storage - "local_json" or "supabase" (default: "local_json")
    
    Outputs:
        storage_instance: Reference to StorageInterface instance
    """
    
    # Class-level cache to share storage instances by path
    _storage_cache: Dict[str, Any] = {}
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize memory storage node"""
        super().__init__(node_id, node_data)
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute memory storage node - create or retrieve storage instance"""
        storage_path = self.get_input_value('storage_path', context, None)
        storage_type = self.get_input_value('storage_type', context, 'local_json')
        
        # Resolve template variables
        if isinstance(storage_path, str) and storage_path.startswith('{{') and storage_path.endswith('}}'):
            var_name = storage_path[2:-2].strip()
            storage_path = context.variables.get(var_name, None)
        
        if isinstance(storage_type, str) and storage_type.startswith('{{') and storage_type.endswith('}}'):
            var_name = storage_type[2:-2].strip()
            storage_type = context.variables.get(var_name, 'local_json')
        
        # Default storage path
        if storage_path is None or storage_path == '':
            home = Path.home()
            storage_path = str(home / ".obelisk-core" / "data" / "default")
        else:
            # If storage_path is provided but not absolute, treat it as a folder name
            # and construct path: ~/.obelisk-core/data/{folder_name}/
            path_obj = Path(storage_path)
            if not path_obj.is_absolute():
                # It's a folder name, construct full path
                home = Path.home()
                storage_path = str(home / ".obelisk-core" / "data" / storage_path)
            else:
                # It's already an absolute path, use as-is
                storage_path = str(path_obj)
        
        # Normalize path (resolve to absolute)
        storage_path = str(Path(storage_path).resolve())
        
        # DEBUG: Log storage path
        logger.debug(f"[MemoryStorage] Using storage_path={storage_path}, storage_type={storage_type}")
        
        # Check cache first
        if storage_path in self._storage_cache:
            logger.debug(f"[MemoryStorage] Using cached storage instance for path={storage_path}")
            return {
                'storage_instance': self._storage_cache[storage_path]
            }
        
        # Create new storage instance
        logger.debug(f"[MemoryStorage] Creating new storage instance for path={storage_path}")
        if storage_type == 'local_json':
            from src.storage.local_json import LocalJSONStorage
            storage_instance = LocalJSONStorage(storage_path=storage_path)
            logger.debug(f"[MemoryStorage] Created LocalJSONStorage: base_path={storage_instance.base_path}, interactions_path={storage_instance.interactions_path}")
        elif storage_type == 'supabase':
            from src.storage.supabase import SupabaseStorage
            # For Supabase, we need URL and key from config or inputs
            # For now, try to get from environment or context
            import os
            supabase_url = os.getenv('SUPABASE_URL', '')
            supabase_key = os.getenv('SUPABASE_KEY', '')
            if not supabase_url or not supabase_key:
                raise ValueError("Supabase storage requires SUPABASE_URL and SUPABASE_KEY environment variables")
            storage_instance = SupabaseStorage(supabase_url=supabase_url, supabase_key=supabase_key)
        else:
            raise ValueError(f"Unknown storage_type: {storage_type}. Must be 'local_json' or 'supabase'")
        
        # Cache the instance
        self._storage_cache[storage_path] = storage_instance
        
        return {
            'storage_instance': storage_instance
        }
