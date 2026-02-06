"""
Abstract storage interface for Obelisk Core
Supports both solo mode (local JSON) and prod mode (Supabase)
"""
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional


class StorageInterface(ABC):
    """Abstract interface for storage backends"""
    
    @abstractmethod
    def get_interactions(self, cycle_id: str) -> List[Dict[str, Any]]:
        """Get all interactions for an evolution cycle"""
        pass
    
    @abstractmethod
    def save_interaction(
        self,
        user_id: str,
        query: str,
        response: str,
        cycle_id: Optional[str] = None,
        quantum_seed: float = 0.0,
        reward_score: float = 0.0
    ) -> str:
        """Save a user interaction"""
        pass
    
    @abstractmethod
    def get_evolution_cycle(self, cycle_id: str) -> Optional[Dict[str, Any]]:
        """Get evolution cycle data"""
        pass
    
    @abstractmethod
    def get_current_evolution_cycle(self) -> Optional[str]:
        """Get current active evolution cycle ID"""
        pass
    
    @abstractmethod
    def save_lora_weights(
        self,
        cycle_number: int,
        lora_weights: bytes,
        evolution_score: float,
        interactions_used: int,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[str]:
        """Save LoRA weights"""
        pass
    
    @abstractmethod
    def get_latest_model_weights(self, base_model: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Get latest active model weights
        
        Args:
            base_model: Model name (defaults to ObeliskLLM.MODEL_NAME if None)
        """
        pass
    
    def delete_lora_weights(self) -> bool:
        """
        Delete all LoRA weights from storage
        
        Returns:
            True if successful, False otherwise
        """
        # Default implementation - override in subclasses
        return False
    
    @abstractmethod
    def get_user_interactions(self, user_id: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get user's own interactions (for solo mode)"""
        pass
    
    @abstractmethod
    def calculate_user_reward_score(self, user_id: str, cycle_id: str) -> Dict[str, Any]:
        """Calculate reward score for a user in a cycle"""
        pass
    
    @abstractmethod
    def create_reward(
        self,
        user_id: str,
        cycle_id: str,
        rank: int,
        tokens_awarded: int,
        interactions_count: int,
        total_score: float
    ) -> Dict[str, Any]:
        """Create a reward record"""
        pass
    
    @abstractmethod
    def update_user_token_balance(self, user_id: str, amount: int) -> Dict[str, Any]:
        """Update user's token balance"""
        pass
    
    @abstractmethod
    def check_nft_upgrades(self, user_id: str) -> List[Dict[str, Any]]:
        """Check and upgrade NFTs based on energy thresholds"""
        pass
    
    @abstractmethod
    def get_or_create_user(self, wallet_address: str) -> str:
        """Get or create user, returns user ID"""
        pass
    
    @abstractmethod
    def save_interaction_ratings(self, ratings: List[Dict[str, Any]], cycle_id: str) -> int:
        """Save AI ratings for interactions"""
        pass
    
    @abstractmethod
    def create_activity_log(
        self,
        activity_type: str,
        message: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Create activity log entry"""
        pass
    
    @abstractmethod
    def get_activity_logs(
        self,
        activity_type: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Get activity logs, optionally filtered by type
        
        Args:
            activity_type: Filter by activity type (e.g., 'telegram_message', 'telegram_summary')
            limit: Maximum number of logs to return
            
        Returns:
            List of activity logs, most recent first
        """
        pass
    
    @abstractmethod
    def update_cycle_status(self, cycle_id: str, status: str, top_contributors: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Update evolution cycle status"""
        pass
