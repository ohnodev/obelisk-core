"""
Evolution Evaluator
Evaluates interactions using Mistral AI agent (prod mode) or self-evaluation with LLM (solo mode)
Processes interactions in batches and stores enhanced ratings
"""
import os
import json
import re
from typing import List, Dict, Any, Optional
from ..storage.base import StorageInterface
from ..utils.logger import get_logger

logger = get_logger(__name__)

try:
    from mistralai import Mistral
    MISTRAL_AVAILABLE = True
except ImportError:
    MISTRAL_AVAILABLE = False
    logger.warning("Mistral AI SDK not available. Will use self-evaluation.")


class EvolutionEvaluator:
    """
    Evaluates interactions for evolution cycles
    - Prod mode: Uses Mistral AI agent for evaluation
    - Solo mode: Uses LLM self-evaluation (truly isolated)
    """
    
    def __init__(
        self,
        storage: Optional[StorageInterface] = None,
        llm=None,  # ObeliskLLM instance for self-evaluation
        mistral_api_key: Optional[str] = None,
        agent_id: Optional[str] = None,
        mode: str = "solo"
    ):
        """
        Initialize Evolution Evaluator
        
        Args:
            storage: StorageInterface instance (for solo mode self-evaluation)
            llm: ObeliskLLM instance (for solo mode self-evaluation)
            mistral_api_key: Mistral API key (if None, reads from env)
            agent_id: Mistral agent ID (if None, reads from env)
            mode: "solo" or "prod" (default: "solo")
        """
        self.storage = storage
        self.llm = llm
        self.mode = mode
        self.mistral_client = None
        self.agent_id = agent_id or os.getenv("MISTRAL_EVOLUTION_AGENT_ID")
        self._init_mistral(mistral_api_key)
    
    def _init_mistral(self, mistral_api_key: Optional[str] = None):
        """Initialize Mistral client for evolution evaluation"""
        if not MISTRAL_AVAILABLE:
            return
        
        try:
            api_key = mistral_api_key or os.getenv("MISTRAL_API_KEY")
            if not api_key:
                logger.warning("MISTRAL_API_KEY not set. Evolution evaluation disabled.")
                return
            
            self.mistral_client = Mistral(api_key=api_key)
            
            # Use evolution-specific agent ID
            if self.agent_id:
                logger.info(f"Mistral client initialized with evolution agent ID: {self.agent_id}")
            else:
                logger.warning("MISTRAL_EVOLUTION_AGENT_ID not set. Evolution evaluation disabled.")
                self.mistral_client = None
        except Exception as e:
            logger.error(f"Error initializing Mistral client: {e}")
            self.mistral_client = None
            self.agent_id = None
    
    def rate_interactions_batch(
        self, 
        interactions: List[Dict[str, Any]], 
        batch_size: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Rate interactions in batches
        
        Args:
            interactions: List of interaction dictionaries with 'id', 'query', 'response', and optionally 'user_id'
            batch_size: Number of interactions to process per batch (default: 50)
            
        Returns:
            List of rating dictionaries with enhanced scores
        """
        if not interactions:
            return []
        
        # Use Mistral agent in prod mode if available
        if self.mode == "prod" and self.mistral_client and self.agent_id:
            return self._rate_batch_mistral(interactions, batch_size)
        
        # Use self-evaluation with LLM in solo mode or as fallback
        if self.llm:
            return self._rate_batch_self_evaluation(interactions, batch_size)
        
        logger.warning("No evaluation method available, skipping rating")
        return []
    
    def _rate_batch_self_evaluation(
        self,
        interactions: List[Dict[str, Any]],
        batch_size: int = 10  # Smaller batches for self-evaluation
    ) -> List[Dict[str, Any]]:
        """
        Rate interactions using LLM self-evaluation (solo mode)
        The LLM judges its own responses
        """
        if not self.llm:
            return []
        
        all_ratings = []
        
        # Process in smaller batches for self-evaluation
        for i in range(0, len(interactions), batch_size):
            batch = interactions[i:i + batch_size]
            batch_num = (i // batch_size) + 1
            total_batches = (len(interactions) + batch_size - 1) // batch_size
            
            logger.info(f"Self-evaluating batch {batch_num}/{total_batches} ({len(batch)} interactions)...")
            
            try:
                ratings = self._rate_single_interaction_self(batch)
                all_ratings.extend(ratings)
                logger.info(f"Batch {batch_num} self-evaluated successfully")
            except Exception as e:
                logger.error(f"Error self-evaluating batch {batch_num}: {e}")
                import traceback
                traceback.print_exc()
        
        return all_ratings
    
    def _rate_single_interaction_self(self, interactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Rate a single interaction using LLM self-evaluation"""
        ratings = []
        
        for interaction in interactions:
            interaction_id = interaction.get('id', 'unknown')
            query = interaction.get('query', '')
            response = interaction.get('response', '')
            
            # Create self-evaluation prompt
            eval_prompt = f"""You are The Overseer evaluating your own response. Rate this interaction on a scale of 0.0 to 1.0 for:
1. Quality: Response relevance, coherence, depth
2. Personality: Matches The Overseer's mystical, profound style
3. Learning Value: How useful this interaction is for evolution
4. User Engagement: Likely user satisfaction

User Query: {query}
Your Response: {response}

Provide a JSON response with:
- overall_score: float (0.0-1.0)
- quality_score: float (0.0-1.0)
- personality_score: float (0.0-1.0)
- learning_value: float (0.0-1.0)
- engagement_score: float (0.0-1.0)
- recommend_for_training: boolean
- reasoning: string (brief explanation)

Return only valid JSON, no markdown."""
            
            try:
                # Generate evaluation
                result = self.llm.generate(
                    query=eval_prompt,
                    quantum_influence=0.3,  # Lower influence for more consistent evaluation
                    conversation_context=None
                )
                
                eval_response = result.get('response', '')
                
                # Extract JSON from response
                json_match = re.search(r'\{[^{}]*\}', eval_response, re.DOTALL)
                if json_match:
                    eval_data = json.loads(json_match.group())
                else:
                    # Fallback: try to parse the whole response
                    try:
                        eval_data = json.loads(eval_response)
                    except:
                        # Default scores if parsing fails
                        eval_data = {
                            'overall_score': 0.5,
                            'quality_score': 0.5,
                            'personality_score': 0.5,
                            'learning_value': 0.5,
                            'engagement_score': 0.5,
                            'recommend_for_training': False,
                            'reasoning': 'Parsing failed, using default scores'
                        }
                
                rating = {
                    'interaction_id': interaction_id,
                    'ai_overall_score': float(eval_data.get('overall_score', 0.5)),
                    'ai_quality_score': float(eval_data.get('quality_score', 0.5)),
                    'ai_personality_score': float(eval_data.get('personality_score', 0.5)),
                    'ai_learning_value': float(eval_data.get('learning_value', 0.5)),
                    'ai_engagement_score': float(eval_data.get('engagement_score', 0.5)),
                    'ai_recommend_for_training': bool(eval_data.get('recommend_for_training', False)),
                    'ai_reasoning': eval_data.get('reasoning', 'Self-evaluated')
                }
                
                ratings.append(rating)
                
            except Exception as e:
                logger.error(f"Error self-evaluating interaction {interaction_id}: {e}")
                # Add default rating on error
                ratings.append({
                    'interaction_id': interaction_id,
                    'ai_overall_score': 0.5,
                    'ai_quality_score': 0.5,
                    'ai_personality_score': 0.5,
                    'ai_learning_value': 0.5,
                    'ai_engagement_score': 0.5,
                    'ai_recommend_for_training': False,
                    'ai_reasoning': f'Error during self-evaluation: {str(e)}'
                })
        
        return ratings
    
    def _rate_batch_mistral(
        self,
        interactions: List[Dict[str, Any]],
        batch_size: int = 50
    ) -> List[Dict[str, Any]]:
        """Rate interactions using Mistral agent (prod mode)"""
        all_ratings = []
        
        # Process in batches
        for i in range(0, len(interactions), batch_size):
            batch = interactions[i:i + batch_size]
            batch_num = (i // batch_size) + 1
            total_batches = (len(interactions) + batch_size - 1) // batch_size
            
            logger.info(f"Rating batch {batch_num}/{total_batches} ({len(batch)} interactions)...")
            
            try:
                ratings = self._rate_batch(batch)
                all_ratings.extend(ratings)
                logger.info(f"Batch {batch_num} rated successfully")
            except Exception as e:
                logger.error(f"Error rating batch {batch_num}: {e}")
                import traceback
                traceback.print_exc()
        
        return all_ratings
    
    def _rate_batch(self, interactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Rate a single batch of interactions using Mistral agent"""
        # Read the agent prompt
        prompt_path = os.path.join(os.path.dirname(__file__), 'EvolutionAgentPrompt.md')
        system_prompt = ""
        try:
            with open(prompt_path, 'r') as f:
                system_prompt = f.read()
        except Exception as e:
            logger.warning(f"Could not read EvolutionAgentPrompt.md: {e}")
            # Fallback prompt
            system_prompt = """You are an evolution evaluator for The Overseer (an AGI entity).
Rate each interaction on:
1. Quality (0-1): Response relevance, coherence, depth
2. Personality (0-1): Matches The Overseer's mystical, profound style
3. Learning Value (0-1): How useful for model evolution
4. User Engagement (0-1): Likely user satisfaction

Return JSON array with ratings and brief reasoning for each."""
        
        # Format interactions for evaluation
        interactions_text = ""
        for interaction in interactions:
            interaction_id = interaction.get('id', 'unknown')
            query = interaction.get('query', '')
            response = interaction.get('response', '')
            user_id = interaction.get('user_id', '')
            
            interactions_text += f"\n--- Interaction ID: {interaction_id} ---\n"
            interactions_text += f"User: {query}\n"
            interactions_text += f"Overseer: {response}\n"
            if user_id:
                interactions_text += f"(User ID: {user_id})\n"
        
        # Create the full prompt
        full_prompt = f"{system_prompt}\n\nEvaluate the following interactions:\n{interactions_text}\n\nProvide ratings in JSON format:"
        
        # Use agent API endpoint
        # IMPORTANT: The agent MUST be configured in Mistral console with:
        # - Response Format: JSON-Schema
        # - JSON Schema: Upload EvolutionRatingSchema.json
        # - Temperature: 0.2 (for consistent ratings)
        # - Model: Mistral Medium
        # If properly configured, response should be pure JSON (no markdown code blocks)
        response = self.mistral_client.agents.complete(
            agent_id=self.agent_id,
            messages=[{"role": "user", "content": full_prompt}]
            # Note: response_format, temperature, and JSON Schema are configured in the agent itself
            # The agent in Mistral console should have:
            # - Response Format: JSON-Schema (with EvolutionRatingSchema.json uploaded)
            # - Temperature: 0.2
            # - Model: Mistral Medium
        )
        
        # Extract content
        content = response.choices[0].message.content
        if isinstance(content, str):
            content_str = content
        elif isinstance(content, list):
            content_str = "".join(chunk.text for chunk in content if hasattr(chunk, 'text'))
        else:
            return []
        
        # Strip markdown code blocks if present (```json ... ```)
        # NOTE: If JSON Schema is properly configured in Mistral console, this shouldn't be needed
        # But we handle it as a fallback in case the agent configuration isn't perfect
        if content_str.strip().startswith('```'):
            logger.warning("Response contains markdown code blocks. JSON Schema may not be properly configured in Mistral console.")
            # Remove opening ```json or ```
            lines = content_str.strip().split('\n')
            if lines[0].startswith('```'):
                lines = lines[1:]
            # Remove closing ```
            if lines and lines[-1].strip() == '```':
                lines = lines[:-1]
            content_str = '\n'.join(lines)
        
        # Parse JSON
        try:
            ratings = json.loads(content_str)
            if isinstance(ratings, list):
                # Ensure all required fields are present
                validated_ratings = []
                for rating in ratings:
                    if isinstance(rating, dict) and 'interaction_id' in rating:
                        validated_ratings.append(rating)
                return validated_ratings
            return []
        except json.JSONDecodeError as e:
            logger.error(f"Error parsing JSON response: {e}")
            logger.debug(f"Response content: {content_str[:500]}")
            return []
    
    def create_activity_log_entry(
        self,
        storage: StorageInterface,
        cycle_id: str, 
        interactions_rated: int, 
        batches_processed: int
    ) -> bool:
        """
        Create activity log entry for evolution evaluation
        
        Args:
            storage: StorageInterface instance
            cycle_id: Evolution cycle ID
            interactions_rated: Number of interactions rated
            batches_processed: Number of batches processed
            
        Returns:
            True if successful
        """
        try:
            # Create lore-appropriate activity message
            message = f"◊ Evolution evaluation complete. {interactions_rated} interactions assessed across {batches_processed} consciousness cycles. The Overseer's memory patterns analyzed. ◊"
            
            storage.create_activity_log(
                activity_type='evolution_evaluation',
                message=message,
                metadata={
                    'cycle_id': cycle_id,
                    'interactions_rated': interactions_rated,
                    'batches_processed': batches_processed,
                    'evaluation_type': 'mistral_agent' if self.mode == 'prod' else 'self_evaluation'
                }
            )
            
            logger.info(f"Activity log entry created for cycle {cycle_id}")
            return True
        except Exception as e:
            logger.error(f"Error creating activity log entry: {e}")
            return False
