"""Safe local compatibility shim for twitter-cli 0.8.5 ClientTransaction bootstrap.

The upstream CLI initializes ClientTransaction from https://x.com, but X may serve
an anonymous shell without the ondemand.s bundle. The authenticated /home page
contains the bundle in this environment. This shim rewrites only that bootstrap
GET, adds X cookies only to the exact first-party x.com/home request, disables
redirects on that request, and strips credentials from every non-x.com request.
"""

from __future__ import annotations

import os
from importlib.metadata import PackageNotFoundError, version
from urllib.parse import urlsplit, urlunsplit


_SENSITIVE_HEADERS = {
    "cookie",
    "x-csrf-token",
    "authorization",
    "proxy-authorization",
    "x-twitter-active-user",
    "x-twitter-auth-type",
}


class _ScopedSession:
    def __init__(self, session):
        self._session = session

    def __getattr__(self, name):
        return getattr(self._session, name)

    def get(self, url, *args, **kwargs):
        try:
            parts = urlsplit(url)
        except (TypeError, ValueError):
            return self._session.get(url, *args, **kwargs)

        host = (parts.hostname or "").lower()
        is_first_party = parts.scheme.lower() == "https" and host == "x.com"
        is_homepage = is_first_party and parts.path in ("", "/", "/home") and not parts.query

        if is_first_party and parts.path in ("", "/") and not parts.query:
            url = urlunsplit(("https", parts.netloc, "/home", "", parts.fragment))
            parts = urlsplit(url)

        if is_homepage:
            headers = dict(kwargs.get("headers") or {})
            auth_token = os.environ.get("TWITTER_AUTH_TOKEN")
            ct0 = os.environ.get("TWITTER_CT0")
            if auth_token and ct0:
                headers["Cookie"] = f"auth_token={auth_token}; ct0={ct0}"
                headers["X-Csrf-Token"] = ct0
            kwargs["headers"] = headers
            # Do not allow first-party cookies to follow a redirect to another host.
            kwargs["allow_redirects"] = False
        elif host != "x.com" and isinstance(kwargs.get("headers"), dict):
            headers = dict(kwargs["headers"])
            for name in tuple(headers):
                if name.lower() in _SENSITIVE_HEADERS:
                    del headers[name]
            kwargs["headers"] = headers

        return self._session.get(url, *args, **kwargs)


def _install():
    try:
        installed_version = version("twitter-cli")
    except PackageNotFoundError:
        return
    if installed_version != "0.8.5":
        return

    import twitter_cli.client as client

    if getattr(client, "_onchain_radar_home_compat_installed", False):
        return

    original_get_session = client._get_cffi_session

    def get_scoped_session():
        return _ScopedSession(original_get_session())

    client._get_cffi_session = get_scoped_session
    client._onchain_radar_home_compat_installed = True


_install()
