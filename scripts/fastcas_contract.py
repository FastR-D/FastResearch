"""Real Go provider -> Node SDK -> running FastResearch HTTP server contract."""
import os
import re
import select
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse, parse_qs

import httpx

issuer = os.environ['FASTCAS_CONTRACT_ISSUER']
origin = os.environ['FASTCAS_CONTRACT_RESEARCH_ORIGIN']
entry = Path(__file__).resolve().parents[1] / 'server/index.mjs'

with tempfile.TemporaryDirectory() as directory:
    env = {**os.environ, 'PORT': str(urlparse(origin).port), 'HOST': '127.0.0.1', 'FASTRESEARCH_DATA_DIR': directory,
           'FASTRESEARCH_ACCOUNT_DATABASE': str(Path(directory)/'accounts.sqlite'), 'ADMIN_USERNAME': 'admin', 'ADMIN_PASSWORD': 'local-admin-password',
           'FASTRESEARCH_PUBLIC_URL': origin, 'FASTRESEARCH_COOKIE_DOMAIN': '', 'FASTRESEARCH_COOKIE_NAME': 'fr_session',
           'FASTRESEARCH_FASTCAS_ISSUER': issuer, 'FASTRESEARCH_FASTCAS_CLIENT_ID': 'research',
           'FASTRESEARCH_FASTCAS_CLIENT_SECRET': 'integration-client-secret-32-characters-long',
           'FASTRESEARCH_FASTCAS_REDIRECT_URI': origin+'/api/auth/fastcas/callback', 'FASTRESEARCH_FASTCAS_ALLOW_LOOPBACK_HTTP': 'true'}
    process = subprocess.Popen(['node', str(entry)], cwd=directory, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.monotonic()+10
        while time.monotonic()<deadline:
            if process.poll() is not None:
                raise AssertionError('Research server failed to start: '+process.stderr.read())
            if select.select([process.stdout], [], [], .2)[0] and 'listening on' in process.stdout.readline():
                break
        else:
            raise AssertionError('Research startup timeout')
        with httpx.Client(base_url=origin, follow_redirects=False, headers={'Origin': origin}) as app, httpx.Client(follow_redirects=False) as browser:
            def complete(url):
                response = browser.get(url)
                assert response.status_code == 302, response.text
                login_url = urljoin(issuer, response.headers['location'])
                request_id = parse_qs(urlparse(login_url).query)['auth_request_id'][0]
                body = browser.get(login_url).text
                if 'name="password"' in body:
                    csrf = re.search(r'name="csrf" value="([^"]+)"', body)[1]
                    response = browser.post(issuer+'/login', data=dict(csrf=csrf, auth_request_id=request_id, email='alice@example.test', password='correct horse battery staple', action='login'), headers={'Origin': issuer})
                    assert response.status_code == 303, response.text
                    body = browser.get(urljoin(issuer, response.headers['location'])).text
                csrf = re.search(r'name="csrf" value="([^"]+)"', body)[1]
                response = browser.post(issuer+'/login', data=dict(csrf=csrf, auth_request_id=request_id, action='approve'), headers={'Origin': issuer})
                assert response.status_code == 303, response.text
                response = browser.get(urljoin(issuer, response.headers['location']))
                assert response.status_code == 302, response.text
                return response.headers['location']

            admin = app.post('/api/admin/login', json={'username':'admin','password':'local-admin-password'}).json()['session']
            made = app.post('/api/admin/keys', json={'person':'Alice'}, headers={'Authorization':'Bearer '+admin}).json()
            key = made['key']
            local = app.post('/api/content/unlock', json={'key':key}).json()
            assert app.put('/api/content/impression', json={'text':'Original notes'}).status_code == 200
            assert app.get('/api/auth/fastcas/available').json()['enabled'] is True
            # Matching display name does not bind or create a project account.
            start = app.get('/api/auth/fastcas/login')
            response = app.get(complete(start.headers['location']))
            assert response.headers['location'] == '/?fastcas=failed'
            assert app.cookies['fr_session'] == local['session']
            assert app.post('/api/auth/fastcas/link', json={'key':key}, headers={'Origin':'https://attacker.example'}).status_code == 403
            assert app.post('/api/auth/fastcas/link', json={'key':'wrong'}).status_code == 403
            start = app.post('/api/auth/fastcas/link', json={'key':key})
            assert start.status_code == 200, start.text
            callback = complete(start.json()['url'])
            response = app.get(callback)
            assert response.headers['location'] == '/?fastcas=complete', response.text
            assert app.cookies['fr_session'] == local['session']
            assert app.get('/api/auth/fastcas/status').json()['link']['state'] == 'active'
            start = app.get('/api/auth/fastcas/login')
            callback = complete(start.headers['location'])
            assert app.get(callback).headers['location'] == '/?fastcas=complete'
            cas = app.get('/api/content/me').json()
            assert cas['accountId'] == local['accountId'] and cas['keyId'] == local['keyId']
            assert cas['impression']['text'] == 'Original notes'
            assert cas['session'] != local['session']
            assert app.get(callback).headers['location'] == '/?fastcas=failed'
            # CAS provenance must not be converted into an independent Key session.
            assert app.post('/api/sso/ticket', json={'audience':'fast-read'}).status_code == 409
            launched = app.get('/api/sso/launch', params={'audience':'fast-read'})
            assert launched.status_code == 302 and 'sso=' not in launched.headers['location']
            assert app.cookies['fr_session'] == cas['session']
            ticket = app.post('/api/sso/ticket', json={'audience':'fast-read'}, headers={'Authorization':'Bearer '+local['session']}).json()['ticket']
            consumed = app.post('/api/sso/consume', json={'ticket':ticket,'audience':'fast-read'}).json()
            assert consumed['keyId'] == local['keyId']
            app.cookies.set('fr_session', cas['session'], domain='127.0.0.1', path='/')
            if signal := os.environ.get('FASTCAS_CONTRACT_STATUS_SIGNAL'):
                Path(signal).write_text('ready')
                deadline = time.monotonic()+8
                while time.monotonic()<deadline and app.get('/api/content/me', headers={'Authorization':'Bearer '+cas['session']}).status_code != 401:
                    time.sleep(.05)
                assert app.get('/api/content/me', headers={'Authorization':'Bearer '+cas['session']}).status_code == 401
                assert app.get('/api/content/me', headers={'Authorization':'Bearer '+local['session']}).status_code == 200
                assert app.get('/api/content/impression', headers={'Authorization':'Bearer '+local['session']}).json()['impression']['text'] == 'Original notes'
                print('FastResearch identity status contract passed: signed event revoked CAS session, Key session preserved')
                raise SystemExit(0)
            csrf = browser.get(issuer+'/api/v1/me').json()['csrf']
            signed_out = browser.post(issuer+'/api/v1/me/logout-all', json={}, headers={'Origin':issuer,'X-CSRF-Token':csrf})
            assert signed_out.status_code == 204, signed_out.text
            deadline = time.monotonic()+5
            while time.monotonic()<deadline and app.get('/api/content/me', headers={'Authorization':'Bearer '+cas['session']}).status_code != 401:
                time.sleep(.05)
            assert app.get('/api/content/me', headers={'Authorization':'Bearer '+cas['session']}).status_code == 401
            assert app.get('/api/content/me', headers={'Authorization':'Bearer '+local['session']}).status_code == 200
            assert app.post('/api/auth/fastcas/revoke', json={'key':key}, headers={'Authorization':'Bearer '+local['session']}).status_code == 200
            assert app.post('/api/content/unlock', json={'key':key}).status_code == 200
        print('FastResearch real-provider contract passed: Key proof, no name merge, bind, login, replay rejection, original content, legacy SSO, global logout delivery, revoke isolation')
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
