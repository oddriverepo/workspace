const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';
const PORT = 8123;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

let server;

test.use({
  channel: 'msedge',
  viewport: { width: 390, height: 844 },
  serviceWorkers: 'block'
});

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const requestedPath = decodeURIComponent(new URL(request.url, `http://${HOST}:${PORT}`).pathname);
    const relativePath = requestedPath === '/' ? '/index.html' : requestedPath;
    let filePath = path.join(FRONTEND_ROOT, relativePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream'
    });
    fs.createReadStream(filePath).pipe(response);
  });

  await new Promise((resolve) => server.listen(PORT, HOST, resolve));
});

test.afterAll(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
});

test('smoke flow do gerador app', async ({ page }) => {
  const proposals = [];
  let nextId = 1;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const pathName = url.pathname;

    const ok = (body) => route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(body)
    });

    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }

    if (pathName === '/api/admin/login' && method === 'POST') {
      return ok({
        token: 'mock-token',
        user: { id: 'admin-1', username: 'pedro', name: 'Pedro', role: 'admin' }
      });
    }

    if (pathName === '/api/admin/me' && method === 'GET') {
      return ok({
        user: { id: 'admin-1', username: 'pedro', name: 'Pedro', role: 'admin' }
      });
    }

    if (pathName === '/api/admin/logout' && method === 'POST') {
      return ok({ ok: true });
    }

    if (pathName === '/api/proposals' && method === 'GET') {
      return ok(proposals);
    }

    if (pathName === '/api/proposals' && method === 'POST') {
      const payload = JSON.parse(request.postData() || '{}');
      const now = new Date().toISOString();
      const proposal = { ...payload, id: payload.id || `mock-${nextId++}`, createdAt: now, updatedAt: now };
      proposals.unshift(proposal);
      return ok(proposal);
    }

    if (/^\/api\/proposals\/.+/.test(pathName)) {
      const id = pathName.split('/').pop();
      const currentIndex = proposals.findIndex((item) => String(item.id) === String(id));

      if (method === 'GET') {
        return ok(currentIndex >= 0 ? proposals[currentIndex] : null);
      }

      if (method === 'PUT') {
        const payload = JSON.parse(request.postData() || '{}');
        const current = currentIndex >= 0 ? proposals[currentIndex] : { id };
        const updated = { ...current, ...payload, id, updatedAt: new Date().toISOString() };
        if (currentIndex >= 0) {
          proposals[currentIndex] = updated;
        } else {
          proposals.unshift(updated);
        }
        return ok(updated);
      }

      if (method === 'DELETE') {
        if (currentIndex >= 0) proposals.splice(currentIndex, 1);
        return ok({ ok: true });
      }
    }

    if (pathName === '/api/slides/token-info' && method === 'GET') {
      return ok({
        accessToken: 'google-mock',
        connectedAt: '2026-04-16T00:00:00.000Z',
        expiresAt: '2026-04-17T00:00:00.000Z'
      });
    }

    if (pathName === '/api/slides/oauth/start' && method === 'POST') {
      return ok({ authUrl: 'https://example.com/oauth' });
    }

    if (pathName === '/api/slides/refresh' && method === 'POST') {
      return ok({ success: true });
    }

    if (pathName === '/api/slides/disconnect' && method === 'POST') {
      return ok({ success: true });
    }

    if (pathName === '/api/settings/google' && method === 'GET') {
      return ok({
        success: true,
        stored: {},
        effective: {
          templateProductIds: {
            'od-in': 'tpl-od-in',
            'od-vt': 'tpl-od-vt',
            'od-drop': 'tpl-od-drop',
            'od-pack': 'tpl-od-pack',
            'od-full': 'tpl-od-full'
          },
          presentationsFolderId: 'folder-presentations',
          assetsFolderId: 'folder-assets'
        }
      });
    }

    if (pathName === '/api/settings/google' && method === 'POST') {
      return ok({ success: true });
    }

    if (pathName === '/api/slides/generate' && method === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      const uploads = Object.keys(body.proposalData?.uploads || {});
      expect(uploads).toEqual(expect.arrayContaining([
        'logo',
        'mock-lateral',
        'mock-mapa',
        'mock-traseiro',
        'odim',
        'planilha'
      ]));
      return ok({
        success: true,
        designId: 'deck-123',
        presentationUrl: 'https://example.com/slides/deck-123',
        uploadDriveUrls: Object.fromEntries(uploads.map((key) => [key, `https://example.com/assets/${key}.png`])),
        progress: [{ progress: 100, message: 'Mock finalizado.' }]
      });
    }

    if (pathName === '/api/slides/export-pdf' && method === 'POST') {
      return ok({
        success: true,
        fileName: 'proposta-mock.pdf',
        base64: 'JVBERi0xLjQKJcTl8uXrp/Og0MTGCjEgMCBvYmoKPDwvVHlwZS9DYXRhbG9nPj4KZW5kb2JqCnRyYWlsZXIKPDwvUm9vdCAxIDAgUj4+CiUlRU9G'
      });
    }

    return route.fulfill({
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: `Unhandled route: ${method} ${pathName}` })
    });
  });

  const baseUrl = `http://${HOST}:${PORT}/gerador-app/`;
  const upload = (fileName) => path.resolve(FRONTEND_ROOT, 'gerador', 'assets', 'upload-placeholders', fileName);

  const uploadFor = async (selector, filePath) => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click(selector)
    ]);
    await chooser.setFiles(filePath);
  };

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await expect(page.locator('#loginForm')).toBeVisible();
  await page.fill('#loginUsername', 'pedro');
  await page.fill('#loginPassword', '123456');
  await page.click('#loginSubmitBtn');
  await expect(page.locator('[data-nav-route="wizard"]')).toBeVisible();
  await page.click('[data-nav-route="wizard"]');

  await page.fill('#draft-nomeAnunciante', 'Nike');
  await page.fill('#draft-nomeEmpresa', 'Nike Brasil');
  await page.fill('#draft-pracas', 'Recife, Olinda');
  await page.fill('#draft-pagamento', '50% entrada, 50% início');
  await page.fill('#draft-numeroCarros', '12');
  await page.fill('#draft-dataInicio', '2026-04-20');
  await page.fill('#draft-tempoCampanhaDias', '30');
  await page.fill('#draft-validadeDias', '7');
  await page.click('#wizardNextBtn');

  await page.click('[data-product-id=\"od-in\"]');
  await page.click('#wizardNextBtn');

  await uploadFor('[data-upload-slot=\"planilha\"][data-upload-source=\"file\"]', upload('planilha-placeholder.png'));
  await page.click('#wizardNextBtn');

  await uploadFor('[data-upload-slot=\"logo\"][data-upload-source=\"file\"]', upload('logo-placeholder.png'));
  await uploadFor('[data-upload-slot=\"mock-lateral\"][data-upload-source=\"file\"]', upload('mock-lateral-placeholder.png'));
  await uploadFor('[data-upload-slot=\"mock-mapa\"][data-upload-source=\"file\"]', upload('mock-frontal-placeholder.png'));
  await uploadFor('[data-upload-slot=\"odim\"][data-upload-source=\"file\"]', upload('od-in-placeholder.png'));
  await uploadFor('[data-upload-slot=\"mock-traseiro\"][data-upload-source=\"file\"]', upload('mock-traseiro-placeholder.png'));

  await page.click('#wizardNextBtn');
  await expect(page.locator('#generateSlidesBtn')).toBeEnabled();

  await page.click('#generateSlidesBtn');
  await expect(page.locator('#generationMessage')).toContainText(/gerada com sucesso/i);
  await expect(page.locator('a[href="https://example.com/slides/deck-123"]')).toBeVisible();
  await expect(page.locator('#generatePdfBtn')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#generatePdfBtn')
  ]);

  expect(download.suggestedFilename()).toBe('proposta-mock.pdf');
  await expect(page.locator('#generatePdfBtn')).toBeVisible();
});
