"""Tiny Vercel KV (Upstash Redis REST) helper.

Reads `KV_REST_API_URL` and `KV_REST_API_TOKEN` from the environment — both are
populated automatically by Vercel when a KV store is linked to the project.

Returns (None, "configured-message") tuples instead of raising so the route
handlers can degrade gracefully when KV isn't wired up yet.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request


class KVNotConfigured(Exception):
    pass


def _base():
    url = os.environ.get("KV_REST_API_URL")
    token = os.environ.get("KV_REST_API_TOKEN")
    if not url or not token:
        raise KVNotConfigured(
            "Vercel KV is not configured. Add a KV store to the project in the "
            "Vercel dashboard so KV_REST_API_URL and KV_REST_API_TOKEN are set."
        )
    return url.rstrip("/"), token


def _request(path):
    url, token = _base()
    req = urllib.request.Request(
        f"{url}/{path}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get(key):
    """Return the string value for `key`, or None if missing."""
    data = _request(f"get/{urllib.parse.quote(key, safe='')}")
    return data.get("result")


def setnx(key, value):
    """Set `key` to `value` only if it does not already exist. Returns True on success."""
    path = f"set/{urllib.parse.quote(key, safe='')}/{urllib.parse.quote(value, safe='')}?nx=true"
    data = _request(path)
    return data.get("result") == "OK"
