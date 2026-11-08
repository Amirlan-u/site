"""Local anime library server. Python 3 standard library only."""

from __future__ import annotations

import argparse
import json
import mimetypes
import re
import socket
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parent / "dist"
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".webm", ".ogg", ".ogv"}
SEASON_PATTERN = re.compile(r"(?:season|сезон|s)\s*[-_. ]*0*(\d+)$", re.I)
EPISODE_PATTERN = re.compile(r"^(?:(?:episode|серия|ep|e)\s*[-_. ]*)?0*(\d+)(?:\s*[-_. ]+\s*(.*))?$", re.I)
SPECIAL_FOLDERS = {"assets", "media", "__pycache__"}


def natural_key(value: str):
    return [int(piece) if piece.isdigit() else piece.casefold() for piece in re.split(r"(\d+)", value)]


def label(value: str) -> str:
    return value.replace("_", " ").strip()


def local_addresses():
    """Return useful LAN addresses without making an internet request."""
    addresses = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, family=socket.AF_INET):
            address = info[4][0]
            if not address.startswith("127.") and not address.startswith("169.254."):
                addresses.add(address)
    except OSError:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 80))
            address = probe.getsockname()[0]
            if not address.startswith("127.") and not address.startswith("169.254."):
                addresses.add(address)
    except OSError:
        pass
    def rank(address):
        if address.startswith("192.168."):
            return (0, address)
        if address.startswith("10."):
            return (1, address)
        if address.startswith("172."):
            return (2, address)
        return (3, address)

    return sorted(addresses, key=rank)


def season_number(folder: Path):
    if folder.name.strip().casefold() in {"season", "сезон"}:
        return 1
    match = SEASON_PATTERN.fullmatch(folder.name.strip())
    if match:
        return int(match.group(1))
    if folder.name.isdigit():
        return int(folder.name)
    return None


def episode_info(stem: str, fallback: int):
    match = EPISODE_PATTERN.fullmatch(stem)
    if match:
        return int(match.group(1)), label(match.group(2) or "")
    match = re.match(r"^(?:s\d+\s*[-_. ]*)?(?:e|ep|серия)\s*0*(\d+)(?:\s*[-_. ]+\s*(.*))?$", stem, re.I)
    if match:
        return int(match.group(1)), label(match.group(2) or "")
    return fallback, label(stem)


def scan_catalog():
    result = []
    if not ROOT.is_dir():
        return result
    for anime in sorted(ROOT.iterdir(), key=lambda p: natural_key(p.name)):
        if not anime.is_dir() or anime.name.startswith(".") or anime.name.lower() in SPECIAL_FOLDERS:
            continue
        season_folders = [(season_number(p), p) for p in anime.iterdir() if p.is_dir() and not p.is_symlink()]
        season_folders = [(n, p) for n, p in season_folders if n is not None]
        seasons = []
        for number, folder in sorted(season_folders, key=lambda pair: (pair[0], natural_key(pair[1].name))):
            files = sorted((p for p in folder.rglob("*") if p.is_file() and not p.is_symlink() and p.suffix.lower() in VIDEO_EXTENSIONS), key=lambda p: natural_key(str(p.relative_to(folder))))
            episodes = {}
            for index, file in enumerate(files, 1):
                ep_num, tail = episode_info(file.stem, index)
                dub = label(file.parent.name) if file.parent != folder else (tail or "Оригинал")
                title = tail if file.parent != folder and tail else f"Серия {ep_num}"
                episode = episodes.setdefault(ep_num, {"number": ep_num, "title": title, "dubs": []})
                if episode["title"].startswith("Серия ") and title != episode["title"]:
                    episode["title"] = title
                relative = file.relative_to(ROOT).as_posix()
                episode["dubs"].append({"name": dub, "src": "/video/" + quote(relative, safe="/")})
            if episodes:
                seasons.append({"number": number, "episodes": [episodes[key] for key in sorted(episodes)]})
        if seasons:
            result.append({"id": anime.name, "title": label(anime.name), "seasons": seasons, "episodeCount": sum(len(s["episodes"]) for s in seasons)})
    return result


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # The UI is small and changes often; stale JS leaves an old player visible.
        if not urlsplit(self.path).path.startswith("/video/"):
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/catalog":
            payload = json.dumps(scan_catalog(), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            return
        if path.startswith("/video/"):
            self.send_video(path)
            return
        super().do_GET()

    def send_video(self, path):
        relative = unquote(path[len("/video/"):])
        target = (ROOT / relative).resolve()
        try:
            target.relative_to(ROOT.resolve())
        except ValueError:
            self.send_error(404)
            return
        if not target.is_file() or target.suffix.lower() not in VIDEO_EXTENSIONS:
            self.send_error(404)
            return
        size = target.stat().st_size
        start, end = 0, size - 1
        range_header = self.headers.get("Range")
        if range_header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
            if not match or (not match.group(1) and not match.group(2)):
                self.send_error(416)
                return
            if match.group(1):
                start = int(match.group(1))
                if match.group(2):
                    end = min(int(match.group(2)), end)
            else:
                start = max(0, size - int(match.group(2)))
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
        self.send_response(206 if range_header else 200)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if range_header:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with target.open("rb") as stream:
            stream.seek(start)
            remaining = end - start + 1
            while remaining:
                chunk = stream.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    break
                remaining -= len(chunk)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Локальная библиотека аниме")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as error:
        parser.exit(1, f"Не удалось запустить сервер на порту {args.port}: {error}\nПопробуйте --port 8081.\n")
    print(f"Папка с сайтом: {ROOT}", flush=True)
    if args.host in {"0.0.0.0", "127.0.0.1", "localhost"}:
        print(f"На этом устройстве: http://127.0.0.1:{args.port}/", flush=True)
    if args.host == "0.0.0.0":
        addresses = local_addresses()
        if addresses:
            for address in addresses:
                print(f"Адрес для другого устройства в той же сети: http://{address}:{args.port}/", flush=True)
        else:
            print("Не удалось определить адрес сети. Узнайте IP этого устройства командой hostname -I (Linux) или ipconfig (Windows).", flush=True)
    elif args.host not in {"127.0.0.1", "localhost"}:
        print(f"Адрес сайта: http://{args.host}:{args.port}/", flush=True)
    print("Оставьте это окно открытым. Для остановки нажмите Ctrl+C.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
