import logging
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
    # uvicorn은 자기 로거만 설정한다. 앱 로그(티켓 분류 · 실행 실패)도 같은 곳에 남긴다.
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s %(message)s")
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
