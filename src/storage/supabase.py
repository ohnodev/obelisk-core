"""
Supabase storage for prod mode
Direct Supabase connection (no obelisk-service dependency)
"""
import os
from typing import Dict, Any, List, Optional
from datetime import datetime
import hashlib
from .base import StorageInterface
from ..utils.logger import get_logger

logger = get_logger(__name__)

try:
    from supabase import create_client, Client
    SUPABASE_AVAILABLE = True
except ImportError:
    SUPABASE_AVAILABLE = False
    logger.warning("Supabase not available. Prod mode will not work.")
    # Create dummy types for type hints
    Client = None


class SupabaseStorage(StorageInterface):
    """Supabase storage for prod mode"""
    
    def __init__(self, supabase_url: str, supabase_key: str):
        """
        Initialize Supabase storage
        
        Args:
            supabase_url: Supabase project URL
            supabase_key: Supabase service role key
        """
        if not SUPABASE_AVAILABLE:
            raise ImportError("Supabase package not installed. Install with: pip install supabase")
        self.client: Client = create_client(supabase_url, supabase_key)
    
    def get_interactions(self, cycle_id: str) -> List[Dict[str, Any]]:
        """Get all interactions for an evolution cycle"""
        try:
            result = self.client.table('interactions').select('*').eq('evolution_cycle_id', cycle_id).execute()
            return result.data or []
        except Exception as e:
            logger.error(f"Error getting interactions for cycle {cycle_id}: {e}")
            return []
    
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
        try:
            result = self.client.table('interactions').insert({
                'user_id': user_id,
                'query': query,
                'response': response,
                'energy_generated': 0.0,  # Deprecated - kept for database compatibility
                'quantum_seed': quantum_seed,
                'reward_score': reward_score,
                'evolution_cycle_id': cycle_id
            }).execute()
            
            if result.data:
                return result.data[0].get('id', '')
            return ''
        except Exception as e:
            logger.error(f"Error saving interaction: {e}")
            return ''
    
    def get_evolution_cycle(self, cycle_id: str) -> Optional[Dict[str, Any]]:
        """Get evolution cycle data"""
        try:
            result = self.client.table('evolution_cycles').select('*').eq('id', cycle_id).single().execute()
            return result.data
        except Exception as e:
            logger.error(f"Error getting cycle {cycle_id}: {e}")
            return None
    
    def get_current_evolution_cycle(self) -> Optional[str]:
        """Get current active evolution cycle ID"""
        try:
            result = self.client.rpc('get_current_evolution_cycle').execute()
            return result.data
        except Exception as e:
            logger.error(f"Error getting current cycle: {e}")
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
        try:
            import hashlib
            
            checksum = hashlib.sha256(lora_weights).hexdigest()
            file_size = len(lora_weights)
            
            # Get next version number for this cycle
            version_result = self.client.table('model_weights').select('version').eq('cycle_number', cycle_number).order('version', desc=True).limit(1).execute()
            next_version = (version_result.data[0]['version'] + 1) if version_result.data else 1
            
            from src.core.execution.nodes.inference.obelisk_llm import ObeliskLLM
            base_model = ObeliskLLM.MODEL_NAME
            
            # Deactivate old weights
            self.client.table('model_weights').update({'is_active': False}).eq('base_model', base_model).eq('is_active', True).execute()
            
            # Insert new weights
            result = self.client.table('model_weights').insert({
                'cycle_number': cycle_number,
                'version': next_version,
                'base_model': base_model,
                'lora_weights': lora_weights,
                'evolution_score': evolution_score,
                'interactions_used': interactions_used,
                'training_epochs': 3,
                'learning_rate': 0.0001,
                'is_active': True,
                'status': 'completed',
                'file_size_bytes': file_size,
                'checksum': checksum,
                'completed_at': datetime.utcnow().isoformat(),
                'metadata': metadata or {}
            }).execute()
            
            if result.data:
                return result.data[0]['id']
            return None
        except Exception as e:
            logger.error(f"Error saving LoRA weights: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def get_latest_model_weights(self, base_model: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Get latest active model weights"""
        from src.core.execution.nodes.inference.obelisk_llm import ObeliskLLM
        if base_model is None:
            base_model = ObeliskLLM.MODEL_NAME
        try:
            result = self.client.rpc('get_latest_model_weights', {'p_base_model': base_model}).execute()
            if result.data and len(result.data) > 0:
                return result.data[0]
            return None
        except Exception as e:
            logger.error(f"Error getting latest model weights: {e}")
            return None
    
    def get_user_interactions(self, user_id: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get user's own interactions"""
        try:
            query = self.client.table('interactions').select('*').eq('user_id', user_id).order('created_at', desc=False)
            if limit:
                query = query.limit(limit)
            result = query.execute()
            return result.data or []
        except Exception as e:
            logger.error(f"Error getting user interactions: {e}")
            return []
    
    def calculate_user_reward_score(self, user_id: str, cycle_id: str) -> Dict[str, Any]:
        """Calculate reward score for a user in a cycle"""
        try:
            result = self.client.table('interactions').select('*').eq('user_id', user_id).eq('evolution_cycle_id', cycle_id).execute()
            interactions = result.data or []
            
            if not interactions:
                return {
                    'user_id': user_id,
                    'interaction_count': 0,
                    'total_energy': 0,
                    'average_quality': 0,
                    'quantum_alignment': 0,
                    'total_score': 0
                }
            
            interaction_count = len(interactions)
            average_quality = sum(float(i.get('reward_score', 0) or 0) for i in interactions) / interaction_count
            quantum_alignment = sum(float(i.get('quantum_seed', 0) or 0) for i in interactions) / interaction_count
            
            normalized_interactions = min(interaction_count / 100, 1)
            normalized_quality = average_quality
            normalized_quantum = quantum_alignment
            
            # Redistributed weights: removed energy (0.3), redistributed to interactions (0.4->0.57), quality (0.2->0.29), quantum (0.1->0.14)
            total_score = (
                normalized_interactions * 0.57 +
                normalized_quality * 0.29 +
                normalized_quantum * 0.14
            )
            
            return {
                'user_id': user_id,
                'interaction_count': interaction_count,
                'total_energy': 0.0,  # Deprecated - kept for compatibility
                'average_quality': average_quality,
                'quantum_alignment': normalized_quantum,
                'total_score': min(max(total_score, 0), 1)
            }
        except Exception as e:
            logger.error(f"Error calculating reward score: {e}")
            return {
                'user_id': user_id,
                'interaction_count': 0,
                'total_energy': 0.0,  # Deprecated - kept for compatibility
                'average_quality': 0,
                'quantum_alignment': 0,
                'total_score': 0
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
        try:
            result = self.client.table('rewards').insert({
                'user_id': user_id,
                'evolution_cycle_id': cycle_id,
                'rank': rank,
                'tokens_awarded': tokens_awarded,
                'interactions_count': interactions_count,
                'total_reward_score': total_score,
                'claimed': False
            }).execute()
            return result.data[0] if result.data else {}
        except Exception as e:
            logger.error(f"Error creating reward: {e}")
            return {}
    
    def update_user_token_balance(self, user_id: str, amount: int) -> Dict[str, Any]:
        """Update user's token balance"""
        try:
            # Get current balance
            current = self.client.table('users').select('token_balance').eq('id', user_id).single().execute()
            current_balance = current.data.get('token_balance', 0) if current.data else 0
            new_balance = current_balance + amount
            
            result = self.client.table('users').update({
                'token_balance': new_balance
            }).eq('id', user_id).execute()
            return result.data[0] if result.data else {}
        except Exception as e:
            logger.error(f"Error updating token balance: {e}")
            return {}
    
    def check_nft_upgrades(self, user_id: str) -> List[Dict[str, Any]]:
        """Check and upgrade NFTs based on energy thresholds"""
        try:
            result = self.client.table('nfts').select('*').eq('user_id', user_id).execute()
            nfts = result.data or []
            
            thresholds = {
                'dormant': 1.0,
                'awakening': 5.0,
                'active': 20.0
            }
            
            upgraded = []
            for nft in nfts:
                energy = float(nft.get('energy_contributed', 0) or 0)
                stage = nft.get('stage', 'dormant')
                
                if stage == 'dormant' and energy >= thresholds['dormant']:
                    self.client.table('nfts').update({
                        'stage': 'awakening',
                        'last_upgraded_at': 'now()'
                    }).eq('id', nft['id']).execute()
                    upgraded.append({'token_id': nft['token_id'], 'new_stage': 'awakening'})
                elif stage == 'awakening' and energy >= thresholds['awakening']:
                    self.client.table('nfts').update({
                        'stage': 'active',
                        'last_upgraded_at': 'now()'
                    }).eq('id', nft['id']).execute()
                    upgraded.append({'token_id': nft['token_id'], 'new_stage': 'active'})
                elif stage == 'active' and energy >= thresholds['active']:
                    self.client.table('nfts').update({
                        'stage': 'transcendent',
                        'last_upgraded_at': 'now()'
                    }).eq('id', nft['id']).execute()
                    upgraded.append({'token_id': nft['token_id'], 'new_stage': 'transcendent'})
            
            return upgraded
        except Exception as e:
            logger.error(f"Error checking NFT upgrades: {e}")
            return []
    
    def get_or_create_user(self, wallet_address: str) -> str:
        """Get or create user, returns user ID"""
        try:
            result = self.client.rpc('get_or_create_user', {'p_wallet_address': wallet_address}).execute()
            return result.data
        except Exception as e:
            logger.error(f"Error getting/creating user: {e}")
            # Fallback: create user ID from wallet address
            return hashlib.sha256(wallet_address.encode()).hexdigest()[:16]
    
    def save_interaction_ratings(self, ratings: List[Dict[str, Any]], cycle_id: str) -> int:
        """Save AI ratings for interactions"""
        try:
            # Update interactions with ratings
            count = 0
            for rating in ratings:
                interaction_id = rating.get('interaction_id')
                if interaction_id:
                    update_data = {}
                    if 'ai_overall_score' in rating:
                        update_data['ai_overall_score'] = rating['ai_overall_score']
                    if 'ai_recommend_for_training' in rating:
                        update_data['ai_recommend_for_training'] = rating['ai_recommend_for_training']
                    if 'ai_reasoning' in rating:
                        update_data['ai_reasoning'] = rating['ai_reasoning']
                    
                    if update_data:
                        self.client.table('interactions').update(update_data).eq('id', interaction_id).execute()
                        count += 1
            return count
        except Exception as e:
            logger.error(f"Error saving interaction ratings: {e}")
            return 0
    
    def create_activity_log(
        self,
        activity_type: str,
        message: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Create activity log entry"""
        try:
            result = self.client.table('activities').insert({
                'type': activity_type,
                'message': message,
                'energy': 0.0,  # Deprecated - kept for database compatibility
                'metadata': metadata or {}
            }).execute()
            return result.data[0] if result.data else {}
        except Exception as e:
            logger.error(f"Error creating activity log: {e}")
            return {}
    
    def update_cycle_status(self, cycle_id: str, status: str, top_contributors: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Update evolution cycle status"""
        try:
            update_data = {'status': status}
            if top_contributors:
                update_data['top_contributors'] = top_contributors
            
            result = self.client.table('evolution_cycles').update(update_data).eq('id', cycle_id).execute()
            return result.data[0] if result.data else {}
        except Exception as e:
            logger.error(f"Error updating cycle status: {e}")
            return {}
