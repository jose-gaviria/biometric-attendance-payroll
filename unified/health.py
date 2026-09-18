import json
import sys
import urllib.request

CHECKS = {
    'face-engine': 'http://127.0.0.1:5001/health',
    'laboratory': 'http://127.0.0.1:8081/health',
    'turnos': 'http://127.0.0.1:3001/api/health',
}


def healthy(name):
    try:
        with urllib.request.urlopen(CHECKS[name], timeout=2) as response:
            body = json.load(response)
            return body.get('ok') is True if name == 'turnos' else body.get('status') == 'healthy'
    except Exception:
        return False


if __name__ == '__main__':
    status = {name: healthy(name) for name in CHECKS}
    print(json.dumps(status))
    sys.exit(0 if all(status.values()) else 1)
