"""
Logging configuration for Obelisk Core
Provides structured logging with appropriate log levels
"""
import logging
import sys
from typing import Optional


def setup_logger(
    name: str = "obelisk_core",
    level: Optional[int] = None,
    format_string: Optional[str] = None
) -> logging.Logger:
    """
    Set up a logger with consistent formatting
    
    Args:
        name: Logger name (default: "obelisk_core")
        level: Log level (default: INFO, or from OBELISK_CORE_DEBUG env)
        format_string: Custom format string (optional)
    
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    
    # Don't add handlers if they already exist
    if logger.handlers:
        return logger
    
    # Set log level
    if level is None:
        import os
        debug_mode = os.getenv("OBELISK_CORE_DEBUG", "").lower() in ("true", "1", "yes")
        level = logging.DEBUG if debug_mode else logging.INFO
    logger.setLevel(level)
    
    # Create console handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    
    # Set format
    if format_string is None:
        format_string = "[%(levelname)s] %(name)s: %(message)s"
    
    formatter = logging.Formatter(format_string)
    handler.setFormatter(formatter)
    
    logger.addHandler(handler)
    
    # Prevent propagation to root logger
    logger.propagate = False
    
    return logger


def get_logger(name: str) -> logging.Logger:
    """
    Get or create a logger for a module
    
    Args:
        name: Module name (typically __name__)
    
    Returns:
        Logger instance
    """
    # Use the module name as the logger name
    logger_name = name.split('.')[-1] if '.' in name else name
    return setup_logger(f"obelisk_core.{logger_name}")
