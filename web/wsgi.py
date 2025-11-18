"""
WSGI entry point for production deployment.

This file is used by WSGI servers like Gunicorn, uWSGI, or PythonAnywhere.

For PythonAnywhere:
    Point your WSGI configuration to this file.

For local testing with Gunicorn:
    gunicorn web.wsgi:application
"""

import sys
from pathlib import Path

from web.app import create_app

# Add the project directory to the Python path
# This ensures imports work correctly in production
project_home = Path(__file__).resolve().parent.parent
if str(project_home) not in sys.path:
    sys.path.insert(0, str(project_home))

# Create the application instance
application = create_app()

# Optional: Print info for debugging deployment issues
if __name__ == "__main__":
    print(f"WSGI application loaded from: {__file__}")
    print(f"Project home: {project_home}")
    print(f"Application: {application}")
