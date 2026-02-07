"""
Setup script for Obelisk Core
"""
from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

# --------------------------------------------------------------------------
# Optional dependency groups (reusable lists to avoid duplication in "full")
# Upper bounds on major versions prevent unexpected breaking changes.
# --------------------------------------------------------------------------
_ml_deps = [
    "torch>=2.0.0,<3",
    "transformers>=4.30.0,<5",
    "peft>=0.4.0,<1",
    "accelerate>=0.20.0,<1",
    "bitsandbytes>=0.41.0,<1",
    "datasets>=2.14.0,<3",
]

_quantum_deps = [
    "qiskit>=1.3.0,<2",
    "qiskit-ibm-runtime>=0.36.0,<1",
]

_ai_deps = [
    "mistralai>=0.1.0,<2",
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
        "fastapi>=0.100.0,<1",
        "uvicorn>=0.23.0,<1",
        "pydantic>=2.0.0,<3",
        "requests>=2.31.0,<3",
        "langchain>=1.0.0,<1.1",
        "langchain-core>=1.0.0,<1.1",
        "supabase>=1.0.0,<3",
        "python-dotenv>=1.0.0,<2",
        "click>=8.0.0,<9",
        "numpy>=1.24.0,<2",
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
