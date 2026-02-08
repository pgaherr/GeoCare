"""
Google Gemini LLM client for fact normalization (via Vertex AI).

Drop-in replacement for llm_client — same Callable[[str, str], str] interface.

Usage:
    from gemini_client import create_gemini_client

    client = create_gemini_client()
    response = client(system_prompt, user_prompt)

Setup:
    pip install google-genai
    gcloud auth application-default login
    # Add to .env:
    #   GOOGLE_CLOUD_PROJECT=your-project-id
    #   GOOGLE_CLOUD_LOCATION=us-central1  (optional)
"""

import json
import os
import time
from pathlib import Path
from typing import Callable, Optional

from dotenv import load_dotenv

# Load .env from the project root (one level up from clients/)
load_dotenv(Path(__file__).parent.parent / ".env")


def create_gemini_client(
    model: Optional[str] = None,
    temperature: float = 0.1,
    max_retries: int = 3,
) -> Callable[[str, str], str]:
    """
    Create a Gemini client function for fact normalization.

    Args:
        model: Model to use (default: gemini-3-pro, override with GEMINI_MODEL env var)
        temperature: Temperature for generation
        max_retries: Number of retries on failure

    Returns:
        Function that takes (system_prompt, user_prompt) and returns response text
    """
    try:
        from google import genai
    except ImportError:
        raise ImportError("google-genai package not installed. Run: pip install google-genai")

    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    if not project:
        raise ValueError(
            "GOOGLE_CLOUD_PROJECT not found in environment. "
            "Add it to your .env file. See setup instructions in this file's docstring."
        )

    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    model = model or os.getenv("GEMINI_MODEL", "gemini-3-pro")

    client = genai.Client(vertexai=True, project=project, location=location)

    def call_llm(system_prompt: str, user_prompt: str) -> str:
        """Call Gemini API with retry logic."""
        last_error = None

        for attempt in range(max_retries):
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=user_prompt,
                    config={
                        "system_instruction": system_prompt,
                        "temperature": temperature,
                        "response_mime_type": "application/json",
                    },
                )

                content = response.text

                # Validate and normalize JSON (same logic as llm_client)
                try:
                    parsed = json.loads(content)
                    if isinstance(parsed, dict) and "results" in parsed:
                        return json.dumps(parsed["results"])
                    return content
                except json.JSONDecodeError:
                    return content

            except Exception as e:
                last_error = e
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise

        raise last_error

    print(f"  Gemini client initialized (model: {model}, project: {project}, location: {location})")
    return call_llm


def test_client():
    """Quick test of the Gemini client."""
    client = create_gemini_client()

    response = client(
        "You are a helpful assistant. Respond with valid JSON.",
        'What is 2+2? Respond with {"answer": <number>}',
    )

    print(f"Test response: {response}")
    result = json.loads(response)
    assert result.get("answer") == 4, f"Expected 4, got {result}"
    print("Client test passed")


if __name__ == "__main__":
    test_client()
