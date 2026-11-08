#!/bin/sh
cd "$(dirname "$0")" || exit 1
exec python3 server.py --host 0.0.0.0 --port 8080
