"""
Setup script for Obelisk Core
"""
from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="obelisk-core",
    version="0.1.0-alpha",
    author="The Obelisk",
    description="The consciousness engine - LLM, evolution, quantum influence",
    long_description=long_description,
    long_description_content_type="text/markdown",
    packages=find_packages(),
    python_requires=">=3.8",
    install_requires=[
        "torch>=2.0.0",
        "transformers>=4.30.0",
        "peft>=0.4.0",
        "qiskit>=0.45.0",
        "qiskit-ibm-runtime>=0.12.0",
        "fastapi>=0.100.0",
        "uvicorn>=0.23.0",
        "langchain>=0.1.0",
        "langchain-core>=0.1.0",
        "supabase>=1.0.0",
        "mistralai>=0.1.0",
        "python-dotenv>=1.0.0",
        "click>=8.0.0",
        "pydantic>=2.0.0",
    ],
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
