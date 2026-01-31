"""
Local JSON storage for solo mode
Stores data in ~/.obelisk-core/data/ as JSON files
Only accessible to the local user
"""
import os
import json
import pickle
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime
import hashlib
from .base import StorageInterface
from ..utils.logger import get_logger

logger = get_logger(__name__)


class LocalJSONStorage(StorageInterface):
    """Local JSON file storage for solo mode"""
    
    def __init__(self, storage_path: Optional[str] = None):
        """
        Initialize local JSON storage
        
        Args:
            storage_path: Base path for storage (default: ~/.obelisk-core/data/)
        """
        if storage_path is None:
            home = Path.home()
            self.base_path = home / ".obelisk-core" / "data"
        else:
            self.base_path = Path(storage_path)
        
        # Create directory structure
        # Memory-related files go in memory/ folder
        self.memory_path = self.base_path / "memory"
        self.interactions_path = self.memory_path / "interactions"
        self.cycles_path = self.base_path / "cycles"
        self.weights_path = self.base_path / "weights"
        self.users_path = self.base_path / "users"
        
        for path in [self.memory_path, self.interactions_path, self.cycles_path, self.weights_path, self.users_path]:
            path.mkdir(parents=True, exist_ok=True)
        
        # Set file permissions (user only)
        os.chmod(self.base_path, 0o700)
        for path in [self.memory_path, self.interactions_path, self.cycles_path, self.weights_path, self.users_path]:
            os.chmod(path, 0o700)
    
    def _get_user_file(self, user_id: str) -> Path:
        """Get file path for user interactions"""
        return self.interactions_path / f"{user_id}.json"
    
    def _get_cycle_file(self, cycle_id: str) -> Path:
        """Get file path for evolution cycle"""
        return self.cycles_path / f"{cycle_id}.json"
    
    def _get_weights_file(self, cycle_number: int, version: int = 1) -> Path:
        """Get file path for LoRA weights"""
        return self.weights_path / f"cycle_{cycle_number}_v{version}.pkl"
    
    def get_interactions(self, cycle_id: str) -> List[Dict[str, Any]]:
        """Get all interactions for an evolution cycle"""
        cycle_file = self._get_cycle_file(cycle_id)
        if not cycle_file.exists():
            return []
        
        try:
            with open(cycle_file, 'r') as f:
                cycle_data = json.load(f)
                return cycle_data.get('interactions', [])
        except Exception as e:
            logger.error(f"Error loading interactions for cycle {cycle_id}: {e}")
            return []
    
    def save_interaction(
        self,
        user_id: str,
        query: str,
        response: str,
        cycle_id: Optional[str] = None,
        energy: float = 0.0,
        quantum_seed: float = 0.0,
        reward_score: float = 0.0
    ) -> str:
        """Save a user interaction"""
        interaction_id = hashlib.sha256(f"{user_id}{query}{datetime.utcnow().isoformat()}".encode()).hexdigest()[:16]
        
        interaction = {
            'id': interaction_id,
            'user_id': user_id,
            'query': query,
            'response': response,
            'energy_generated': energy,
            'quantum_seed': quantum_seed,
            'reward_score': reward_score,
            'evolution_cycle_id': cycle_id,
            'created_at': datetime.utcnow().isoformat()
        }
        
        # Save to user's file
        user_file = self._get_user_file(user_id)
        interactions = []
        if user_file.exists():
            try:
                with open(user_file, 'r') as f:
                    interactions = json.load(f)
            except:
                interactions = []
        
        interactions.append(interaction)
        
        with open(user_file, 'w') as f:
            json.dump(interactions, f, indent=2)
        os.chmod(user_file, 0o600)  # User read/write only
        
        # If cycle_id provided, also save to cycle file
        if cycle_id:
            cycle_file = self._get_cycle_file(cycle_id)
            cycle_interactions = []
            if cycle_file.exists():
                try:
                    with open(cycle_file, 'r') as f:
                        cycle_data = json.load(f)
                        cycle_interactions = cycle_data.get('interactions', [])
                except:
                    cycle_data = {'id': cycle_id, 'interactions': []}
            
            cycle_interactions.append(interaction)
            cycle_data = cycle_data if 'cycle_data' in locals() else {'id': cycle_id, 'interactions': []}
            cycle_data['interactions'] = cycle_interactions
            
            with open(cycle_file, 'w') as f:
                json.dump(cycle_data, f, indent=2)
            os.chmod(cycle_file, 0o600)
        
        return interaction_id
    
    def get_evolution_cycle(self, cycle_id: str) -> Optional[Dict[str, Any]]:
        """Get evolution cycle data"""
        cycle_file = self._get_cycle_file(cycle_id)
        if not cycle_file.exists():
            return None
        
        try:
            with open(cycle_file, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading cycle {cycle_id}: {e}")
            return None
    
    def get_current_evolution_cycle(self) -> Optional[str]:
        """Get current active evolution cycle ID"""
        # In solo mode, we'll use a simple approach: find the most recent cycle
        cycles = []
        for cycle_file in self.cycles_path.glob("*.json"):
            try:
                with open(cycle_file, 'r') as f:
                    cycle_data = json.load(f)
                    if cycle_data.get('status') == 'active':
                        cycles.append((cycle_data.get('created_at', ''), cycle_data.get('id')))
            except:
                continue
        
        if cycles:
            cycles.sort(reverse=True)
            return cycles[0][1]
        return None
    
    def save_lora_weights(
        self,
        cycle_number: int,
        lora_weights: bytes,
        evolution_score: float,
        interactions_used: int,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[str]:
        """Save LoRA weights"""
        # Find next version
        version = 1
        weights_file = self._get_weights_file(cycle_number, version)
        while weights_file.exists():
            version += 1
            weights_file = self._get_weights_file(cycle_number, version)
        
        try:
            with open(weights_file, 'wb') as f:
                pickle.dump(lora_weights, f)
            os.chmod(weights_file, 0o600)
            
            # Save metadata
            metadata_file = weights_file.with_suffix('.json')
            metadata_data = {
                'cycle_number': cycle_number,
                'version': version,
                'evolution_score': evolution_score,
                'interactions_used': interactions_used,
                'file_size_bytes': len(lora_weights),
                'checksum': hashlib.sha256(lora_weights).hexdigest(),
                'created_at': datetime.utcnow().isoformat(),
                'base_model': metadata.get('base_model') if metadata else None,  # Extract base_model to top level
                'metadata': metadata or {}
            }
            with open(metadata_file, 'w') as f:
                json.dump(metadata_data, f, indent=2)
            os.chmod(metadata_file, 0o600)
            
            return str(weights_file)
        except Exception as e:
            logger.error(f"Error saving LoRA weights: {e}")
            return None
    
    def get_latest_model_weights(self, base_model: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Get latest active model weights"""
        from src.llm.obelisk_llm import ObeliskLLM
        if base_model is None:
            base_model = ObeliskLLM.MODEL_NAME
        
        # Find most recent weights file
        weights_files = []
        for weights_file in self.weights_path.glob("*.pkl"):
            metadata_file = weights_file.with_suffix('.json')
            if metadata_file.exists():
                try:
                    with open(metadata_file, 'r') as f:
                        metadata = json.load(f)
                        # Check if base_model matches, or if base_model is missing (backward compatibility)
                        saved_base_model = metadata.get('base_model') or metadata.get('metadata', {}).get('base_model')
                        if saved_base_model == base_model or saved_base_model is None:
                            weights_files.append((metadata.get('created_at', ''), weights_file, metadata))
                except:
                    continue
        
        if weights_files:
            weights_files.sort(reverse=True)
            _, weights_file, metadata = weights_files[0]
            try:
                with open(weights_file, 'rb') as f:
                    lora_weights = pickle.load(f)
                metadata['lora_weights'] = lora_weights
                return metadata
            except Exception as e:
                logger.error(f"Error loading weights: {e}")
                return None
        return None
    
    def delete_lora_weights(self) -> bool:
        """Delete all LoRA weights from storage"""
        try:
            deleted_count = 0
            for weights_file in self.weights_path.glob("*.pkl"):
                metadata_file = weights_file.with_suffix('.json')
                try:
                    weights_file.unlink()
                    if metadata_file.exists():
                        metadata_file.unlink()
                    deleted_count += 1
                except Exception as e:
                    logger.warning(f"Error deleting {weights_file}: {e}")
            
            if deleted_count > 0:
                logger.info(f"Deleted {deleted_count} LoRA weight file(s)")
                return True
            else:
                logger.info("No LoRA weights found to delete")
                return True  # Still return True if nothing to delete
        except Exception as e:
            logger.error(f"Error deleting LoRA weights: {e}")
            return False
    
    def get_user_interactions(self, user_id: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get user's own interactions (for solo mode)"""
        user_file = self._get_user_file(user_id)
        if not user_file.exists():
            return []
        
        try:
            with open(user_file, 'r') as f:
                interactions = json.load(f)
                if limit:
                    return interactions[-limit:]
                return interactions
        except Exception as e:
            logger.error(f"Error loading user interactions: {e}")
            return []
    
    def calculate_user_reward_score(self, user_id: str, cycle_id: str) -> Dict[str, Any]:
        """Calculate reward score for a user in a cycle"""
        interactions = self.get_interactions(cycle_id)
        user_interactions = [i for i in interactions if i.get('user_id') == user_id]
        
        if not user_interactions:
            return {
                'user_id': user_id,
                'interaction_count': 0,
                'total_energy': 0,
                'average_quality': 0,
                'quantum_alignment': 0,
                'total_score': 0
            }
        
        interaction_count = len(user_interactions)
        total_energy = sum(float(i.get('energy_generated', 0) or 0) for i in user_interactions)
        average_quality = sum(float(i.get('reward_score', 0) or 0) for i in user_interactions) / interaction_count
        quantum_alignment = sum(float(i.get('quantum_seed', 0) or 0) for i in user_interactions) / interaction_count
        
        normalized_interactions = min(interaction_count / 100, 1)
        normalized_energy = min(total_energy / 10, 1)
        normalized_quality = average_quality
        normalized_quantum = quantum_alignment
        
        total_score = (
            normalized_interactions * 0.4 +
            normalized_energy * 0.3 +
            normalized_quality * 0.2 +
            normalized_quantum * 0.1
        )
        
        return {
            'user_id': user_id,
            'interaction_count': interaction_count,
            'total_energy': total_energy,
            'average_quality': average_quality,
            'quantum_alignment': normalized_quantum,
            'total_score': min(max(total_score, 0), 1)
        }
    
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
        reward = {
            'id': hashlib.sha256(f"{user_id}{cycle_id}{rank}".encode()).hexdigest()[:16],
            'user_id': user_id,
            'evolution_cycle_id': cycle_id,
            'rank': rank,
            'tokens_awarded': tokens_awarded,
            'interactions_count': interactions_count,
            'total_reward_score': total_score,
            'claimed': False,
            'created_at': datetime.utcnow().isoformat()
        }
        
        # Save to cycle file
        cycle_file = self._get_cycle_file(cycle_id)
        cycle_data = self.get_evolution_cycle(cycle_id) or {'id': cycle_id, 'rewards': []}
        if 'rewards' not in cycle_data:
            cycle_data['rewards'] = []
        cycle_data['rewards'].append(reward)
        
        with open(cycle_file, 'w') as f:
            json.dump(cycle_data, f, indent=2)
        os.chmod(cycle_file, 0o600)
        
        return reward
    
    def update_user_token_balance(self, user_id: str, amount: int) -> Dict[str, Any]:
        """Update user's token balance"""
        user_file = self.users_path / f"{user_id}.json"
        user_data = {'id': user_id, 'token_balance': 0}
        
        if user_file.exists():
            try:
                with open(user_file, 'r') as f:
                    user_data = json.load(f)
            except:
                pass
        
        current_balance = user_data.get('token_balance', 0)
        user_data['token_balance'] = current_balance + amount
        user_data['updated_at'] = datetime.utcnow().isoformat()
        
        with open(user_file, 'w') as f:
            json.dump(user_data, f, indent=2)
        os.chmod(user_file, 0o600)
        
        return user_data
    
    def check_nft_upgrades(self, user_id: str) -> List[Dict[str, Any]]:
        """Check and upgrade NFTs based on energy thresholds (solo mode: not applicable)"""
        # In solo mode, NFT upgrades are handled by obelisk-service
        return []
    
    def get_or_create_user(self, wallet_address: str) -> str:
        """Get or create user, returns user ID"""
        user_id = hashlib.sha256(wallet_address.encode()).hexdigest()[:16]
        user_file = self.users_path / f"{user_id}.json"
        
        if not user_file.exists():
            user_data = {
                'id': user_id,
                'wallet_address': wallet_address,
                'token_balance': 0,
                'created_at': datetime.utcnow().isoformat()
            }
            with open(user_file, 'w') as f:
                json.dump(user_data, f, indent=2)
            os.chmod(user_file, 0o600)
        
        return user_id
    
    def save_interaction_ratings(self, ratings: List[Dict[str, Any]], cycle_id: str) -> int:
        """Save AI ratings for interactions"""
        cycle_file = self._get_cycle_file(cycle_id)
        cycle_data = self.get_evolution_cycle(cycle_id) or {'id': cycle_id, 'interactions': [], 'ratings': []}
        
        if 'ratings' not in cycle_data:
            cycle_data['ratings'] = []
        
        cycle_data['ratings'].extend(ratings)
        
        with open(cycle_file, 'w') as f:
            json.dump(cycle_data, f, indent=2)
        os.chmod(cycle_file, 0o600)
        
        return len(ratings)
    
    def create_activity_log(
        self,
        activity_type: str,
        message: str,
        energy: float,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Create activity log entry"""
        activity = {
            'id': hashlib.sha256(f"{activity_type}{message}{datetime.utcnow().isoformat()}".encode()).hexdigest()[:16],
            'type': activity_type,
            'message': message,
            'energy': energy,
            'metadata': metadata or {},
            'created_at': datetime.utcnow().isoformat()
        }
        
        # Save to activities file (in memory folder)
        activities_file = self.memory_path / "activities.json"
        activities = []
        if activities_file.exists():
            try:
                with open(activities_file, 'r') as f:
                    activities = json.load(f)
            except:
                activities = []
        
        activities.append(activity)
        
        with open(activities_file, 'w') as f:
            json.dump(activities, f, indent=2)
        os.chmod(activities_file, 0o600)
        
        return activity
    
    def update_cycle_status(self, cycle_id: str, status: str, top_contributors: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Update evolution cycle status"""
        cycle_data = self.get_evolution_cycle(cycle_id) or {'id': cycle_id}
        cycle_data['status'] = status
        if top_contributors:
            cycle_data['top_contributors'] = top_contributors
        cycle_data['updated_at'] = datetime.utcnow().isoformat()
        
        cycle_file = self._get_cycle_file(cycle_id)
        with open(cycle_file, 'w') as f:
            json.dump(cycle_data, f, indent=2)
        os.chmod(cycle_file, 0o600)
        
        return cycle_data
