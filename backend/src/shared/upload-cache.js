(function initUploadCache() {
  if (window.uploadCache) return;

  const SUPPORTS_INDEXED_DB = typeof indexedDB !== 'undefined';
  const DB_NAME = 'wizardUploads';
  const STORE_NAME = 'uploads';
  let dbPromise = null;

  function openDb() {
    if (!SUPPORTS_INDEXED_DB) {
      return Promise.reject(new Error('IndexedDB is not supported'));
    }

    if (dbPromise) {
      return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onerror = () => reject(request.error || new Error('Failed to open upload cache'));
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'slotId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });

    return dbPromise;
  }

  function runTransaction(mode, handler) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, mode);
          const store = tx.objectStore(STORE_NAME);
          const request = handler(store);
          tx.oncomplete = () => resolve(request?.result);
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  async function saveUpload(slotId, payload = {}) {
    if (!SUPPORTS_INDEXED_DB || !slotId || !payload) {
      console.warn('[UploadCache] saveUpload abortado - IndexedDB:', SUPPORTS_INDEXED_DB, 'slotId:', slotId, 'payload:', !!payload);
      return;
    }
    try {
      await runTransaction('readwrite', (store) => store.put({ slotId, ...payload, updatedAt: Date.now() }));
      try {
        console.log('[UploadCache] saved upload for slot:', slotId, 'size:', (payload.data || payload.base64)?.length || payload.dataUrl?.length || 0);
        
        // Verificação imediata para confirmar gravação (apenas para planilha)
        if (slotId === 'planilha') {
          const verification = await getUpload(slotId);
          console.log('[UploadCache] verificação imediata após save de planilha:', {
            found: !!verification,
            hasData: !!(verification?.data),
            dataLength: verification?.data?.length || 0
          });
        }
      } catch (e) {
        // ignore logging errors
      }
    } catch (error) {
      console.warn('[UploadCache] Falha ao salvar upload', error);
    }
  }

  async function removeUpload(slotId) {
    if (!SUPPORTS_INDEXED_DB || !slotId) return;
    try {
      await runTransaction('readwrite', (store) => store.delete(slotId));
    } catch (error) {
      console.warn('[UploadCache] Falha ao remover upload', error);
    }
  }

  async function getUpload(slotId) {
    if (!SUPPORTS_INDEXED_DB || !slotId) return null;
    try {
      const result = await runTransaction('readonly', (store) => store.get(slotId));
      if (slotId === 'planilha') {
        console.log('[UploadCache] getUpload(planilha) ->', {
          exists: !!result,
          hasData: !!(result?.data),
          dataLength: result?.data?.length || 0,
          hasBase64: !!(result?.base64),
          base64Length: result?.base64?.length || 0,
          hasDataUrl: !!(result?.dataUrl),
          dataUrlLength: result?.dataUrl?.length || 0
        });
      }
      return result;
    } catch (error) {
      console.warn('[UploadCache] Falha ao obter upload', error);
      return null;
    }
  }

  async function hydrateUploads(uploads = {}) {
    if (!SUPPORTS_INDEXED_DB || !uploads) {
      console.log('[UploadCache] hydrateUploads skipped - no IndexedDB or no uploads');
      return uploads || {};
    }

    const slotIds = Object.keys(uploads);
    if (!slotIds.length) {
      console.log('[UploadCache] hydrateUploads - no slots to hydrate');
      return uploads;
    }

    console.log('[UploadCache] hydrateUploads - processing slots:', slotIds);

    await Promise.all(
      slotIds.map(async (slotId) => {
        const cached = await getUpload(slotId);
        if (cached && uploads[slotId]) {
          const beforeData = uploads[slotId].data;
          uploads[slotId].data = cached.data || cached.base64 || null;
          uploads[slotId].dataUrl = cached.dataUrl || null;
          if (!uploads[slotId].previewUrl && cached.dataUrl) {
            uploads[slotId].previewUrl = cached.dataUrl;
          }
          
          if (slotId === 'planilha') {
            console.log('[UploadCache] hydrated planilha:', {
              hadDataBefore: !!(beforeData),
              hasDataAfter: !!(uploads[slotId].data),
              dataLengthAfter: uploads[slotId].data?.length || 0
            });
          }
        } else if (slotId === 'planilha') {
          console.warn('[UploadCache] planilha slot exists but no cached data found or upload slot missing');
        }
      })
    );

    return uploads;
  }

  async function clearAll() {
    if (!SUPPORTS_INDEXED_DB) return;
    try {
      await runTransaction('readwrite', (store) => store.clear());
    } catch (error) {
      console.warn('[UploadCache] Falha ao limpar cache', error);
    }
  }

  function cloneWithoutHeavyUploads(data) {
    if (!data) return {};
    let clone;
    if (typeof structuredClone === 'function') {
      clone = structuredClone(data);
    } else {
      clone = JSON.parse(JSON.stringify(data));
    }

    if (clone.uploads) {
      Object.keys(clone.uploads).forEach((slotId) => {
        const entry = clone.uploads[slotId];
        if (!entry) return;

        // Se temos IndexedDB, podemos limpar os blobs (inclusive planilha) e confiar no cache.
        // Only strip heavy fields if the upload was already persisted to IndexedDB.
        // This avoids removing data from drafts when the cache exists but the
        // specific upload wasn't saved (script load-order or save failure).
        if (SUPPORTS_INDEXED_DB && entry._cached) {
          delete entry.data;
          delete entry.dataUrl;
          delete entry.previewUrl;
          return;
        }

        // Sem IndexedDB, preserva tudo (inclusive planilha) para não perder dados.
      });
    }
    return clone;
  }

  window.uploadCache = {
    isSupported: SUPPORTS_INDEXED_DB,
    save: saveUpload,
    remove: removeUpload,
    hydrateUploads,
    sanitizeProposalData: cloneWithoutHeavyUploads,
    clearAll
  };
})();
