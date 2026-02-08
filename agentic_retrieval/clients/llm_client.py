"""
OpenAI LLM client for fact normalization.

Usage:
    from llm_client import create_openai_client
    
    client = create_openai_client()
    response = client(system_prompt, user_prompt)
"""

import os
import json
from pathlib import Path
from typing import Callable, Optional

from dotenv import load_dotenv

# Load .env from the project root (one level up from clients/)
load_dotenv(Path(__file__).parent.parent / ".env")


def create_openai_client(
    model: Optional[str] = None,
    temperature: float = 0.1,
    max_retries: int = 3,
) -> Callable[[str, str], str]:
    """
    Create an OpenAI client function for fact normalization.
    
    Args:
        model: Model to use (default: gpt-4o-mini, can override with OPENAI_MODEL env var)
        temperature: Temperature for generation (low = more deterministic)
        max_retries: Number of retries on failure
    
    Returns:
        Function that takes (system_prompt, user_prompt) and returns response text
    """
    try:
        from openai import OpenAI
    except ImportError:
        raise ImportError("openai package not installed. Run: pip install openai")
    
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError(
            "OPENAI_API_KEY not found in environment. "
            "Create a .env file with your API key. See .env.example"
        )
    
    model = model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    client = OpenAI(api_key=api_key)
    
    def call_llm(system_prompt: str, user_prompt: str) -> str:
        """Call OpenAI API with retry logic."""
        last_error = None
        
        for attempt in range(max_retries):
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    response_format={"type": "json_object"},
                    timeout=60.0,
                )
                
                content = response.choices[0].message.content
                
                # Validate it's parseable JSON
                try:
                    parsed = json.loads(content)
                    # If it's a dict with a "results" key, extract just that
                    if isinstance(parsed, dict) and "results" in parsed:
                        return json.dumps(parsed["results"])
                    return content
                except json.JSONDecodeError:
                    # Return as-is, let caller handle
                    return content
                    
            except Exception as e:
                last_error = e
                if attempt < max_retries - 1:
                    import time
                    time.sleep(2 ** attempt)  # Exponential backoff
                    continue
                raise
        
        raise last_error
    
    print(f"  OpenAI client initialized (model: {model})")
    return call_llm


def test_client():
    """Quick test of the OpenAI client."""
    client = create_openai_client()
    
    response = client(
        "You are a helpful assistant. Respond with valid JSON.",
        'What is 2+2? Respond with {"answer": <number>}'
    )
    
    print(f"Test response: {response}")
    result = json.loads(response)
    assert result.get("answer") == 4, f"Expected 4, got {result}"
    print("✓ Client test passed")


if __name__ == "__main__":
    test_client()
