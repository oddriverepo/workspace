const axios = require('axios');
const FormData = require('form-data');

class GoogleSlidesClient {
  /**
   * @param {string} accessToken
   * @param {{ tokenRefresher?: () => Promise<string> }} opts
   */
  constructor(accessToken, { tokenRefresher } = {}) {
    this.accessToken = accessToken;
    this._tokenRefresher = tokenRefresher || null;
    this._rebuildSlides();
  }

  _rebuildSlides() {
    this.slides = axios.create({
      baseURL: 'https://slides.googleapis.com/v1',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
  }

  get authHeader() {
    return {
      Authorization: `Bearer ${this.accessToken}`
    };
  }

  /** Executa requestFn; se 401 e há tokenRefresher, renova e retenta uma vez */
  async _request(requestFn) {
    try {
      return await requestFn();
    } catch (err) {
      const status = err?.response?.status;
      if ((status === 401 || status === 403) && this._tokenRefresher) {
        console.log('[GoogleSlidesClient] Token expirado, renovando...');
        this.accessToken = await this._tokenRefresher();
        this._rebuildSlides();
        return await requestFn();
      }
      throw err;
    }
  }

  async copyPresentation(templateId, title, folderId) {
    const body = { name: title };
    if (folderId) {
      body.parents = [folderId];
    }

    return this._request(async () => {
      const response = await axios.post(
        `https://www.googleapis.com/drive/v3/files/${templateId}/copy`,
        body,
        {
          headers: {
            ...this.authHeader,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data;
    });
  }

  async batchUpdate(presentationId, requests) {
    if (!requests || !requests.length) return null;
    return this._request(async () => {
      try {
        const response = await this.slides.post(
          `/presentations/${presentationId}:batchUpdate`,
          { requests }
        );
        return response.data;
      } catch (error) {
        const respData = error?.response?.data;
        console.error('[GoogleSlidesClient] batchUpdate failed:', respData || error?.message || error);
        const message = respData ? `Google Slides API error: ${JSON.stringify(respData)}` : (error.message || 'Unknown Slides error');
        const err = new Error(message);
        err.original = error;
        throw err;
      }
    });
  }

  async getPresentation(presentationId) {
    return this._request(async () => {
      const response = await this.slides.get(`/presentations/${presentationId}`);
      return response.data;
    });
  }

  async exportPresentationPdf(presentationId) {
    return this._request(async () => {
      // Primary: Google Slides native export (same engine as UI "Download as PDF", higher quality)
      try {
        const response = await axios.get(
          `https://docs.google.com/presentation/d/${presentationId}/export/pdf`,
          {
            headers: this.authHeader,
            responseType: 'arraybuffer',
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          }
        );
        if (response.data && response.data.byteLength > 0) {
          console.log(`[GoogleSlidesClient] PDF exported via Slides native endpoint (${response.data.byteLength} bytes)`);
          return response.data;
        }
      } catch (err) {
        console.warn('[GoogleSlidesClient] Slides native export failed, falling back to Drive API:', err?.response?.status || err.message);
      }

      // Fallback: Drive Export API
      const response = await axios.get(
        `https://www.googleapis.com/drive/v3/files/${presentationId}/export`,
        {
          headers: this.authHeader,
          responseType: 'arraybuffer',
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          params: {
            mimeType: 'application/pdf'
          }
        }
      );
      console.log(`[GoogleSlidesClient] PDF exported via Drive API fallback (${response.data.byteLength} bytes)`);
      return response.data;
    });
  }

  async uploadImage(buffer, filename, folderId) {
    // Detect MIME type from buffer (JPEG starts with FF D8 FF)
    const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
    const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
    const ext = isJpeg ? '.jpg' : '.png';

    const metadata = {
      name: filename || ('placeholder-image' + ext),
      mimeType
    };

    if (folderId) {
      metadata.parents = [folderId];
    }

    return this._request(async () => {
      const form = new FormData();
      form.append('metadata', JSON.stringify(metadata), {
        contentType: 'application/json'
      });
      form.append('file', buffer, {
        filename: filename || ('image' + ext),
        contentType: mimeType
      });

      const response = await axios.post(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        form,
        {
          headers: {
            ...this.authHeader,
            ...form.getHeaders()
          }
        }
      );
      return response.data;
    });
  }

  async shareFilePublicly(fileId) {
    try {
      return await this._request(async () => {
        const response = await axios.post(
          `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
          {
            role: 'reader',
            type: 'anyone'
          },
          {
            headers: {
              ...this.authHeader,
              'Content-Type': 'application/json'
            }
          }
        );
        return response.data;
      });
    } catch (error) {
      console.warn('[Google Slides] Falha ao tornar arquivo público:', error.response?.data || error.message);
      return null;
    }
  }
}

module.exports = GoogleSlidesClient;
