from redis import Redis
from rq import Worker
from rq.serializers import JSONSerializer

from shared.config import get_settings
from shared.logging import configure_logging


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    connection = Redis.from_url(settings.redis_url.get_secret_value())
    Worker(
        [settings.queue_name],
        connection=connection,
        serializer=JSONSerializer,
        log_job_description=False,
    ).work(logging_level=settings.log_level)


if __name__ == "__main__":
    main()
