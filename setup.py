"""
Setup script for Obelisk Core — Inference Service

The core execution engine and agent runtime are now TypeScript (ts/).
This setup.py covers only the Python inference service (src/inference/).
"""
from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="obelisk-core",
    version="0.2.0-alpha",
    author="The Obelisk",
    description="Obelisk inference service — LLM model hosting and API",
    long_description=long_description,
    long_description_content_type="text/markdown",
    packages=find_packages(),
    python_requires=">=3.10,<3.13",
    install_requires=[
        "torch>=2.2.0,<3",
        "transformers>=4.38.0,<5",
        "accelerate>=0.27.0,<1",
        "bitsandbytes>=0.43.0,<1",
        "fastapi>=0.100.0,<1",
        "uvicorn>=0.23.0,<1",
        "pydantic>=2.0.0,<3",
        "python-dotenv>=1.0.0,<2",
        "numpy>=1.24.0,<2",
    ],
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
    ],
)
