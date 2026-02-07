"""
Setup script for Obelisk Core
"""
from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

# --------------------------------------------------------------------------
# Optional dependency groups (reusable lists to avoid duplication in "full")
# --------------------------------------------------------------------------
_ml_deps = [
    "torch>=2.0.0",
    "transformers>=4.30.0",
    "peft>=0.4.0",
    "accelerate>=0.20.0",
    "bitsandbytes>=0.41.0",
    "datasets>=2.14.0",
]

_quantum_deps = [
    "qiskit>=1.0.0",
    "qiskit-ibm-runtime>=0.20.0",
]

_ai_deps = [
    "mistralai>=0.1.0",
]

setup(
    name="obelisk-core",
    version="0.1.0-alpha",
    author="The Obelisk",
    description="The consciousness engine - LLM, evolution, quantum influence",
    long_description=long_description,
    long_description_content_type="text/markdown",
    packages=find_packages(),
    python_requires=">=3.8",
    # Lightweight runtime deps only — enough for the Docker agent container.
    # Heavy ML/quantum deps are in extras_require["ml"] and ["quantum"].
    install_requires=[
        "fastapi>=0.100.0",
        "uvicorn>=0.23.0",
        "pydantic>=2.0.0",
        "requests>=2.31.0",
        "langchain>=0.1.0",
        "langchain-core>=0.1.0",
        "supabase>=1.0.0",
        "python-dotenv>=1.0.0",
        "click>=8.0.0",
        "numpy>=1.24.0",
    ],
    extras_require={
        "ml": _ml_deps,                                # torch, transformers, peft, …
        "quantum": _quantum_deps,                      # qiskit
        "ai": _ai_deps,                                # mistralai
        "full": _ml_deps + _quantum_deps + _ai_deps,   # everything
    },
    entry_points={
        "console_scripts": [
            "obelisk-core=src.cli.main:cli",
        ],
    },
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
)
