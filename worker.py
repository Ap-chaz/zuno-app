# worker.py - runs the background jobs in ONE dedicated process.
#
# Railway: create a second service from this repo with start command
#     python worker.py
# and leave RUN_SCHEDULER unset on the web service.

from app import create_app
from app.services.scheduler import run_blocking

if __name__ == '__main__':
    run_blocking(create_app(run_scheduler=False))
