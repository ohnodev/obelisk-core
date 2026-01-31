"""
Core service container and bootstrap module
Provides centralized service initialization and dependency management
"""
from .container import ServiceContainer
from .bootstrap import get_container
from .config import Config

__all__ = ["ServiceContainer", "get_container", "Config"]
