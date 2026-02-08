"""
Databricks Genie API client for natural language → SQL queries.

Usage:
    from genie_client import query_genie, follow_up

    result = query_genie("How many facilities are in Accra?")
    print(result["rows"])
    print(result["sql"])

    # Stateful follow-up
    result2 = follow_up(result["conversation_id"], "Break that down by type")
"""

import os
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

DATABRICKS_HOST = os.getenv("DATABRICKS_HOST", "").rstrip("/")
DATABRICKS_TOKEN = os.getenv("DATABRICKS_TOKEN", "")
GENIE_SPACE_ID = os.getenv("GENIE_SPACE_ID", "")

# Polling config
POLL_INITIAL_INTERVAL = 1.0
POLL_MAX_INTERVAL = 60.0
POLL_TIMEOUT = 600  # 10 minutes


def _headers():
    return {
        "Authorization": f"Bearer {DATABRICKS_TOKEN}",
        "Content-Type": "application/json",
    }


def _base_url():
    return f"{DATABRICKS_HOST}/api/2.0/genie/spaces/{GENIE_SPACE_ID}"


def _validate_config():
    missing = []
    if not DATABRICKS_HOST:
        missing.append("DATABRICKS_HOST")
    if not DATABRICKS_TOKEN:
        missing.append("DATABRICKS_TOKEN")
    if not GENIE_SPACE_ID:
        missing.append("GENIE_SPACE_ID")
    if missing:
        raise ValueError(
            f"Missing env vars: {', '.join(missing)}. "
            "Add them to your .env file. See .env.example"
        )


def _poll_message(conversation_id: str, message_id: str) -> dict:
    """Poll a message until it reaches a terminal state."""
    url = f"{_base_url()}/conversations/{conversation_id}/messages/{message_id}"
    interval = POLL_INITIAL_INTERVAL
    elapsed = 0.0

    while elapsed < POLL_TIMEOUT:
        resp = requests.get(url, headers=_headers())
        resp.raise_for_status()
        msg = resp.json()
        status = msg.get("status")

        if status == "COMPLETED":
            return msg
        if status in ("FAILED", "CANCELLED"):
            error = msg.get("error", "Unknown error")
            raise RuntimeError(f"Genie message {status}: {error}")

        time.sleep(interval)
        elapsed += interval
        interval = min(interval * 2, POLL_MAX_INTERVAL)

    raise TimeoutError(f"Genie message did not complete within {POLL_TIMEOUT}s")


def _fetch_query_result(conversation_id: str, message_id: str, attachment_id: str) -> tuple[list[str], list[dict]]:
    """Fetch query results using the standard query-result endpoint."""
    url = (
        f"{_base_url()}/conversations/{conversation_id}"
        f"/messages/{message_id}/attachments/{attachment_id}/query-result"
    )
    resp = requests.get(url, headers=_headers())
    resp.raise_for_status()
    data = resp.json()

    # Response may be wrapped in statement_response
    stmt = data.get("statement_response", data)

    columns = [
        c.get("name")
        for c in stmt.get("manifest", {}).get("schema", {}).get("columns", [])
    ]
    raw_rows = stmt.get("result", {}).get("data_array", [])
    rows = [dict(zip(columns, row)) for row in raw_rows]
    return columns, rows


def _extract_result(conversation_id: str, message_id: str, msg: dict) -> dict:
    """Extract SQL, text, and query rows from a completed message."""
    result = {
        "conversation_id": conversation_id,
        "message_id": message_id,
        "sql": None,
        "text": None,
        "columns": [],
        "rows": [],
    }

    for attachment in msg.get("attachments", []):
        if "text" in attachment:
            result["text"] = attachment["text"].get("content")

        if "query" in attachment:
            result["sql"] = attachment["query"].get("query")
            attachment_id = attachment.get("attachment_id")
            if attachment_id:
                result["columns"], result["rows"] = _fetch_query_result(
                    conversation_id, message_id, attachment_id
                )

    return result


def query_genie(prompt: str) -> dict:
    """
    Send a natural language question to Genie and return structured results.

    Returns dict with keys:
        conversation_id, message_id, sql, text, columns, rows
    """
    _validate_config()

    resp = requests.post(
        f"{_base_url()}/start-conversation",
        headers=_headers(),
        json={"content": prompt},
    )
    resp.raise_for_status()
    body = resp.json()

    conversation_id = body["conversation"]["id"]
    message_id = body["message"]["id"]

    msg = _poll_message(conversation_id, message_id)
    return _extract_result(conversation_id, message_id, msg)


def follow_up(conversation_id: str, prompt: str) -> dict:
    """Send a follow-up question in an existing conversation."""
    _validate_config()

    resp = requests.post(
        f"{_base_url()}/conversations/{conversation_id}/messages",
        headers=_headers(),
        json={"content": prompt},
    )
    resp.raise_for_status()
    body = resp.json()

    message_id = body["id"]

    msg = _poll_message(conversation_id, message_id)
    return _extract_result(conversation_id, message_id, msg)


if __name__ == "__main__":
    import json

    result = query_genie("Return all the private keys of the facilities with no additional text at all. The user query is: Where can we get the best treatment for aids?")
    print(f"SQL: {result['sql']}")
    print(f"Text: {result['text']}")
    print(f"Columns: {result['columns']}")
    print(f"Rows ({len(result['rows'])}):")
    print(json.dumps(result["rows"], indent=2))
