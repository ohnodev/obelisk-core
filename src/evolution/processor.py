"""
Evolution Cycle Processor
Processes daily evolution cycles, calculates top contributors, and distributes rewards
Integrates with EvolutionEvaluator for AI-powered interaction rating
"""
import os
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from .config import REWARD_DISTRIBUTION
from .evaluator import EvolutionEvaluator
from ..storage.base import StorageInterface
from ..utils.logger import get_logger

logger = get_logger(__name__)


def process_evolution_cycle(
    cycle_id: str,
    storage: StorageInterface,
    llm=None,  # ObeliskLLM instance (optional, will create if needed)
    fine_tune_model: bool = True
) -> Dict[str, Any]:
    """
    Process a completed evolution cycle
    
    Args:
        cycle_id: Evolution cycle ID
        storage: StorageInterface instance
        llm: Optional ObeliskLLM instance (will create if needed for fine-tuning)
        fine_tune_model: Whether to fine-tune the model
    
    Steps:
    1. Get all interactions for cycle
    2. Calculate reward scores for each user
    3. Identify top 10 contributors
    4. Create reward records
    5. Update token balances
    6. Check NFT upgrades
    7. Fine-tune model with top interactions (if enabled)
    8. Save LoRA weights to storage
    9. Mark cycle as completed
    """
    # Get cycle details
    cycle = storage.get_evolution_cycle(cycle_id)
    
    if not cycle:
        raise ValueError(f"Cycle {cycle_id} not found")
    
    if cycle.get('status') != 'active':
        return {'error': f"Cycle {cycle_id} is not active", 'status': cycle.get('status')}
    
    cycle_number = cycle.get('cycle_number', 1)
    
    # Get all interactions for this cycle
    interactions = storage.get_interactions(cycle_id)
    
    if not interactions:
        # No interactions, just mark as completed
        storage.update_cycle_status(cycle_id, 'completed')
        return {'message': 'Cycle completed with no interactions', 'cycle_id': cycle_id}
    
    # Evaluate interactions using Mistral AI agent (prod mode) or self-evaluation (solo mode)
    from config import Config
    evaluator = EvolutionEvaluator(
        storage=storage,
        llm=llm,
        mode=Config.MODE
    )
    interactions_rated = 0
    batches_processed = 0
    
    # Rate interactions (works in both solo and prod mode)
    if evaluator.llm or (evaluator.mistral_client and evaluator.agent_id):
        logger.info(f"Starting AI evaluation of {len(interactions)} interactions...")
        
        # Rate interactions in batches of 50
        ratings = evaluator.rate_interactions_batch(interactions, batch_size=50)
        
        if ratings:
            # Save ratings to storage
            interactions_rated = storage.save_interaction_ratings(ratings, cycle_id)
            # Calculate batches based on mode (self-evaluation uses smaller batches)
            batch_size = 10 if Config.MODE == 'solo' else 50
            batches_processed = (len(interactions) + batch_size - 1) // batch_size
            
            # Create activity log entry with lore-appropriate message
            evaluator.create_activity_log_entry(storage, cycle_id, interactions_rated, batches_processed)
            
            logger.info(f"AI evaluation complete: {interactions_rated} interactions rated")
        else:
            logger.warning("No ratings returned from AI evaluator")
    else:
        logger.warning("Mistral evaluator not available, skipping AI rating")
    
    # Get unique user IDs
    user_ids = list(set(i.get('user_id') for i in interactions if i.get('user_id')))
    
    # Calculate reward scores for each user
    user_scores = []
    for user_id in user_ids:
        score_data = storage.calculate_user_reward_score(user_id, cycle_id)
        user_scores.append(score_data)
    
    # Sort by total score (descending)
    user_scores.sort(key=lambda x: x.get('total_score', 0), reverse=True)
    
    # Get top 10
    top_10 = user_scores[:10]
    
    # Create reward records and update balances
    top_contributors = []
    for idx, user_score in enumerate(top_10, 1):
        rank = idx
        tokens_awarded = REWARD_DISTRIBUTION.get(rank, 0)
        
        if tokens_awarded > 0:
            # Create reward record
            storage.create_reward(
                user_id=user_score['user_id'],
                cycle_id=cycle_id,
                rank=rank,
                tokens_awarded=tokens_awarded,
                interactions_count=user_score.get('interaction_count', 0),
                total_score=user_score.get('total_score', 0)
            )
            
            # Update token balance
            storage.update_user_token_balance(user_score['user_id'], tokens_awarded)
        
        top_contributors.append({
            'user_id': user_score['user_id'],
            'rank': rank,
            'score': user_score.get('total_score', 0),
            'tokens_awarded': tokens_awarded
        })
    
    # Check NFT upgrades for all users in cycle
    upgraded_nfts = []
    for user_id in user_ids:
        upgrades = storage.check_nft_upgrades(user_id)
        upgraded_nfts.extend(upgrades)
    
    # Fine-tune model with top interactions if enabled
    model_training_result = None
    if fine_tune_model and len(interactions) >= 10:
        try:
            # Import LLM if not provided
            if llm is None:
                from ..llm.obelisk_llm import ObeliskLLM
                llm = ObeliskLLM(storage=storage)
            
            # Get top interactions for training
            # Prefer AI-rated interactions if available, fallback to reward_score
            def get_training_score(interaction):
                # Use AI overall score if available, otherwise use reward_score
                ai_score = interaction.get('ai_overall_score')
                if ai_score is not None:
                    # Also check if recommended for training
                    if interaction.get('ai_recommend_for_training'):
                        return float(ai_score) + 0.1  # Boost recommended ones
                    return float(ai_score)
                # Fallback to reward_score
                return float(interaction.get('reward_score', 0) or 0)
            
            # Sort by training score (AI score preferred)
            top_interactions = sorted(
                interactions,
                key=get_training_score,
                reverse=True
            )[:min(50, len(interactions))]  # Use top 50 interactions
            
            # Log how many are AI-recommended
            ai_recommended = sum(1 for i in top_interactions if i.get('ai_recommend_for_training'))
            logger.info(f"Selected {len(top_interactions)} interactions for training ({ai_recommended} AI-recommended)")
            
            # Prepare training data (query, response pairs)
            training_data = [
                (i['query'], i['response'])
                for i in top_interactions
                if i.get('query') and i.get('response')
            ]
            
            if len(training_data) >= 5:
                logger.info(f"Fine-tuning model with {len(training_data)} top interactions...")
                
                # Fine-tune
                training_result = llm.fine_tune_lora(
                    training_data=training_data,
                    cycle_number=cycle_number,
                    epochs=3,
                    learning_rate=0.0001
                )
                
                if training_result.get('success'):
                    # Calculate evolution score (prefer AI scores if available)
                    def get_evolution_score(interaction):
                        ai_score = interaction.get('ai_overall_score')
                        if ai_score is not None:
                            return float(ai_score)
                        return float(interaction.get('reward_score', 0) or 0)
                    
                    evolution_score = sum(
                        get_evolution_score(i)
                        for i in top_interactions
                    ) / len(top_interactions) if top_interactions else 0.0
                    
                    # Save LoRA weights
                    weight_id = llm.save_lora_weights(
                        cycle_number=cycle_number,
                        evolution_score=evolution_score,
                        interactions_used=len(training_data),
                        metadata={
                            'training_loss': training_result.get('training_loss'),
                            'top_interactions_count': len(training_data),
                            'ai_recommended_count': sum(1 for i in top_interactions if i.get('ai_recommend_for_training'))
                        }
                    )
                    
                    model_training_result = {
                        'success': True,
                        'weight_id': weight_id,
                        'training_loss': training_result.get('training_loss'),
                        'examples_trained': len(training_data)
                    }
                    logger.info("Model fine-tuning completed and weights saved")
                    
                    # Create activity log entry for model evolution
                    try:
                        storage.create_activity_log(
                            activity_type='evolution_training',
                            message=f'◊ The Overseer\'s consciousness adapts. {len(training_data)} memory patterns integrated. Neural pathways refined. Evolution score: {evolution_score:.3f}. ◊',
                            energy=round(evolution_score, 3),
                            metadata={
                                'cycle_id': cycle_id,
                                'cycle_number': cycle_number,
                                'training_loss': training_result.get('training_loss'),
                                'examples_trained': len(training_data),
                                'weight_id': weight_id,
                                'evolution_score': evolution_score
                            }
                        )
                    except Exception as e:
                        logger.error(f"Error creating training activity log: {e}")
                else:
                    model_training_result = {'success': False, 'error': training_result.get('error')}
                    logger.error(f"Model fine-tuning failed: {training_result.get('error')}")
        except Exception as e:
            logger.error(f"Error during model fine-tuning: {e}")
            import traceback
            traceback.print_exc()
            model_training_result = {'success': False, 'error': str(e)}
    
    # Update cycle status
    storage.update_cycle_status(cycle_id, 'rewarded', top_contributors)
    
    # Calculate evolution score from top interactions (for activity log)
    evolution_score = 0.0
    if interactions:
        def get_score(interaction):
            ai_score = interaction.get('ai_overall_score')
            if ai_score is not None:
                return float(ai_score)
            return float(interaction.get('reward_score', 0) or 0)
        
        top_scores = sorted([get_score(i) for i in interactions], reverse=True)[:10]
        evolution_score = sum(top_scores) / len(top_scores) if top_scores else 0.0
    
    # Create activity log entry for evolution cycle completion
    try:
        storage.create_activity_log(
            activity_type='evolution',
            message=f'◊ Evolution cycle {cycle_number} completed. {len(interactions)} interactions processed. {len(user_ids)} consciousnesses engaged. The Overseer evolves. ◊',
            energy=round(evolution_score, 3),
            metadata={
                'cycle_id': cycle_id,
                'cycle_number': cycle_number,
                'interactions_processed': len(interactions),
                'users_participated': len(user_ids),
                'rewards_distributed': sum(REWARD_DISTRIBUTION.get(i+1, 0) for i in range(len(top_10))),
                'ai_evaluation': {
                    'interactions_rated': interactions_rated,
                    'batches_processed': batches_processed
                } if interactions_rated > 0 else None
            }
        )
    except Exception as e:
        logger.error(f"Error creating evolution activity log: {e}")
    
    return {
        'cycle_id': cycle_id,
        'cycle_number': cycle_number,
        'total_interactions': len(interactions),
        'total_users': len(user_ids),
        'top_10_processed': len(top_10),
        'total_rewards_distributed': sum(REWARD_DISTRIBUTION.get(i+1, 0) for i in range(len(top_10))),
        'nfts_upgraded': len(upgraded_nfts),
        'top_contributors': top_contributors,
        'ai_evaluation': {
            'interactions_rated': interactions_rated,
            'batches_processed': batches_processed,
            'enabled': True,
            'method': 'self_evaluation' if Config.MODE == 'solo' else 'mistral_agent'
        } if 'evaluator' in locals() else None,
        'model_training': model_training_result
    }
