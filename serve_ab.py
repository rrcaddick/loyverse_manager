import sys
sys.meta_path = [f for f in sys.meta_path if "editable" not in type(f).__name__.lower() and "editable" not in str(getattr(f, "__module__", "")).lower()]
sys.path.insert(0, "/home/ray/repos/python/loyverse_manager-ab")
from web.app import create_app
import web.app as m
print("serving from", m.__file__, flush=True)
create_app().run(port=5300, use_reloader=False)
