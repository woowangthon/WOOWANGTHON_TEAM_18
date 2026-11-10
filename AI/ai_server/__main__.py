import sys

import uvicorn

from ai_server.config import ConfigError, load_settings
from ai_server.main import create_app


def main() -> None:
    try:
        settings = load_settings()
    except ConfigError as e:
        print(e, file=sys.stderr)
        sys.exit(1)
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
