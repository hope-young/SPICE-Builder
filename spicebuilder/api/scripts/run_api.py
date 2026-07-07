"""Run SpiceBuilder API server.

Usage:
    python -m spicebuilder.api.scripts.run_api
    python -m spicebuilder.api.scripts.run_api --host 0.0.0.0 --port 8765
"""
import argparse
import uvicorn

from spicebuilder.api.server import app


def main():
    parser = argparse.ArgumentParser(description="SpiceBuilder API server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="Bind port (default 8765, matches Tauri Rust python_backend.rs)")
    parser.add_argument("--reload", action="store_true", help="Auto-reload (dev only)")
    parser.add_argument("--log-level", default="info", help="Log level")
    args = parser.parse_args()

    print(f"SpiceBuilder API starting on http://{args.host}:{args.port}")
    print(f"Docs: http://{args.host}:{args.port}/docs")

    uvicorn.run(
        "spicebuilder.api.server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level=args.log_level,
    )


if __name__ == "__main__":
    main()
