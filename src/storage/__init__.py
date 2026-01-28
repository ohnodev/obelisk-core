"""
Storage module for Obelisk Core
"""
from .base import StorageInterface
from .local_json import LocalJSONStorage
from .supabase import SupabaseStorage

__all__ = ['StorageInterface', 'LocalJSONStorage', 'SupabaseStorage']
