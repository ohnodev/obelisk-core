"""
Inference Config Node
Configures the inference service endpoint and provides an InferenceClient to downstream nodes.

Replaces ModelLoaderNode — instead of loading a model into memory,
this node creates an InferenceClient that calls the inference service API.
Downstream nodes (InferenceNode, BinaryIntentNode, TelegramMemoryCreatorNode)
call model.generate() as before — they don't know or care that it's an HTTP call.

NOTE: LoRA is not supported via the inference client yet.
The LoRA workflow requires direct model access. When remote LoRA support
is needed, it will be added as an endpoint on the inference service.
"""
from typing import Dict, Any
from ..node_base import BaseNode, ExecutionContext
from ....utils.logger import get_logger

logger = get_logger(__name__)

# Client cache: endpoint_url → InferenceClient instance
# Shared across all InferenceConfigNode instances so we don't create
# multiple clients for the same endpoint
_client_cache: Dict[str, Any] = {}


class InferenceConfigNode(BaseNode):
    """
    Configures the inference service endpoint.
    
    Properties (from UI widgets):
        endpoint_url: URL of the inference service (default: http://localhost:7780)
        use_default: If True, ignores endpoint_url and uses http://localhost:7780
    
    Outputs:
        model: InferenceClient instance (duck-types as ObeliskLLM)
    """
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Create or retrieve a cached InferenceClient for the configured endpoint"""
        
        use_default = self.metadata.get('use_default', True)
        endpoint_url = self.metadata.get('endpoint_url', '')
        
        # Resolve endpoint
        from .inference.inference_client import InferenceClient
        
        if use_default or not endpoint_url:
            endpoint_url = InferenceClient.DEFAULT_ENDPOINT
        
        # Normalize
        endpoint_url = endpoint_url.strip().rstrip("/")
        
        # Cache by endpoint URL so multiple nodes pointing to the same
        # service share one client instance
        if endpoint_url not in _client_cache:
            logger.info(f"InferenceConfigNode {self.node_id}: creating client → {endpoint_url}")
            _client_cache[endpoint_url] = InferenceClient(endpoint_url)
        else:
            logger.debug(f"InferenceConfigNode {self.node_id}: using cached client → {endpoint_url}")
        
        return {
            'model': _client_cache[endpoint_url]
        }
